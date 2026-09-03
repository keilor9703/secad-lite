import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Inject, forwardRef, Optional, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, FindOptionsWhere, LessThan, MoreThanOrEqual, Not, Repository, Brackets } from 'typeorm';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity, TipoEvento } from './evento.entity';
import { CANALES, EstadoCaso, ESTADOS, PRIORIDADES } from './caso.model';
import { CatalogosService } from '../catalogos/catalogos.service';
import { DespachoService } from '../despacho/despacho.service';
import { TenantsService } from '../tenants/tenants.service';
import { CasosGateway } from './casos.gateway';
import { TenantRlsService } from '../common/tenant-rls.service';

/**
 * Quién actúa. `permisos` son los VIGENTES (resueltos contra la base por
 * PermisosGuard), no los del token. `canales` son las colas que atiende, y
 * definen qué casos puede siquiera ver.
 */
export interface Actor {
  sub: string;
  rol: string;
  permisos: string[];
  canales?: string[];
  /** Agencia del funcionario; queda como origen de lo que recepcione. */
  agencia?: string | null;
}
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { RemitirDto } from './dto/remitir.dto';
import { RemitirTenantDto } from './dto/remitir-tenant.dto';

/**
 * Casos persistidos en PostgreSQL. Todo consulta/escribe SIEMPRE acotado por
 * `tenant` (modelo pooled). Cada acción relevante queda registrada en la bitácora
 * de auditoría (casos_eventos) para reconstruir la línea de tiempo del caso.
 */
@Injectable()
export class CasosService implements OnModuleInit {
  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
    @InjectRepository(EventoCasoEntity)
    private readonly eventos: Repository<EventoCasoEntity>,
    private readonly despacho: DespachoService,
    private readonly catalogos: CatalogosService,
    private readonly tenants: TenantsService,
    private readonly rls: TenantRlsService,
    @Optional()
    @Inject(forwardRef(() => CasosGateway))
    private readonly gateway?: CasosGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * Bandeja del secad, acotada en SQL: por defecto los 200 casos más
   * recientes (tope 500), y con `abiertos` solo los no cerrados — así el
   * tablero de Despacho, que se refresca cada 30 s, no arrastra meses de
   * historial en cada consulta. El alcance por canales del funcionario se
   * filtra en memoria sobre esa tanda (la lista de canales del caso se
   * guarda como arreglo simple).
   */
  async listar(
    tenant: string,
    actor: Actor,
    opts?: { limite?: number; abiertos?: boolean; desde?: string; hasta?: string },
  ): Promise<CasoEntity[]> {
    return this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(CasoEntity);
      const limite = Math.min(Math.max(Math.trunc(opts?.limite ?? 200) || 200, 1), 500);
      const where: FindOptionsWhere<CasoEntity> = { tenant };
      if (opts?.abiertos) where.estado = Not('cerrado');
      // Rango por fecha de recepción (aaaa-mm-dd, inclusive en ambos extremos):
      // 'hasta' se corre al día siguiente para abarcar el día completo.
      const desde = this.fechaValida(opts?.desde);
      const hasta = this.fechaValida(opts?.hasta);
      const finExclusivo = hasta ? new Date(hasta.getTime() + 864e5) : null;
      if (desde && finExclusivo) where.creadoEn = Between(desde, finExclusivo);
      else if (desde) where.creadoEn = MoreThanOrEqual(desde);
      else if (finExclusivo) where.creadoEn = LessThan(finExclusivo);

      if (actor.rol !== 'superadmin' && !actor.permisos.includes('casos.ver_todos')) {
        const qb = repo.createQueryBuilder('caso')
          .where('caso.tenant = :tenant', { tenant });
        if (opts?.abiertos) qb.andWhere('caso.estado != :estado', { estado: 'cerrado' });
        if (desde && finExclusivo) qb.andWhere('caso.creadoEn >= :desde AND caso.creadoEn < :hasta', { desde, hasta: finExclusivo });
        else if (desde) qb.andWhere('caso.creadoEn >= :desde', { desde });
        else if (finExclusivo) qb.andWhere('caso.creadoEn < :hasta', { hasta: finExclusivo });

        const ids = actor.canales ?? [];
        qb.andWhere(
          new Brackets((qbInner) => {
            qbInner.where('caso.creadoPor = :sub', { sub: actor.sub });
            ids.forEach((id, idx) => {
              qbInner.orWhere(`caso.canales LIKE :id${idx}`, { [`id${idx}`]: `%${id}%` });
            });
          }),
        );
        return qb.orderBy('caso.creadoEn', 'DESC').take(limite).getMany();
      }

      const casos = await repo.find({ where, order: { creadoEn: 'DESC' }, take: limite });
      return casos.filter((c) => this.alcanza(c, actor));
    });
  }

  /** aaaa-mm-dd → Date, o null si viene vacío o malformado. */
  private fechaValida(v?: string): Date | null {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * ¿Este funcionario puede ver este caso?
   *
   * Con `casos.ver_todos` (supervisión) sí, siempre. Sin él, solo lo que esté
   * en alguna de sus colas o lo que él mismo recepcionó — un despachador de un
   * canal no tiene por qué ver lo de los demás canales.
   */
  private alcanza(caso: CasoEntity, actor: Actor): boolean {
    if (actor.rol === 'superadmin' || actor.permisos.includes('casos.ver_todos')) return true;
    if (caso.creadoPor === actor.sub) return true;
    const mios = new Set(actor.canales ?? []);
    return (caso.canales ?? []).some((id) => mios.has(id));
  }

  /**
   * Caso por id. Con `actor` se verifica además el alcance: un caso fuera de
   * sus canales se responde como inexistente, para no revelar que existe.
   */
  async obtener(tenant: string, id: string, actor?: Actor): Promise<CasoEntity> {
    return this.rls.conTenant(tenant, async (manager) => {
      const caso = await manager.getRepository(CasoEntity).findOne({ where: { tenant, id } });
      if (!caso) throw new NotFoundException('Caso no encontrado.');
      if (actor && !this.alcanza(caso, actor)) throw new NotFoundException('Caso no encontrado.');
      return caso;
    });
  }

  /** Línea de tiempo de un caso (valida antes que el caso pertenezca al tenant). */
  async listarAuditoria(tenant: string, casoId: string, actor?: Actor): Promise<EventoCasoEntity[]> {
    await this.obtener(tenant, casoId, actor);
    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(EventoCasoEntity).find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } }),
    );
  }

  async crear(tenant: string, dto: CrearCasoDto, usuario: string, agenciaOrigenId?: string | null): Promise<CasoEntity> {
    if (!dto?.ciudadano?.trim()) throw new BadRequestException('El ciudadano es obligatorio.');
    if (!CANALES.includes(dto.canal)) throw new BadRequestException('Canal inválido.');
    if (dto.prioridad && !PRIORIDADES.includes(dto.prioridad)) throw new BadRequestException('Prioridad inválida.');

    // La tipificación manda: de ella salen el resumen y la prioridad si el
    // operador no los sobreescribe, igual que en el CAD completo.
    const tipificacion = await this.tipificar(tenant, dto.codigoCaso);
    const titulo = (dto.titulo?.trim() || tipificacion?.descripcion || '').trim();
    if (!titulo) throw new BadRequestException('Indique el código de caso o un título.');

    const { responsable, canales, agencias } = await this.resolverAtencion(
      tenant, dto, tipificacion?.agenciaSugeridaId ?? null,
    );

    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(CasoEntity);
      const caso = await repo.save(
        repo.create({
          tenant,
          canal: dto.canal,
          titulo,
          descripcion: dto.descripcion?.trim() ?? '',
          ciudadano: dto.ciudadano.trim(),
          telefono: dto.telefono?.trim() || null,
          direccionLlamante: dto.direccionLlamante?.trim() || null,
          codigoCaso: tipificacion?.codigo ?? null,
          prioridad: dto.prioridad ?? tipificacion?.prioridad ?? 'media',
          ciudad: dto.ciudad?.trim() || null,
          barrio: dto.barrio?.trim() || null,
          direccion: dto.direccion?.trim() || null,
          // `agencia` (texto) se conserva denormalizada: es lo que agrupan las
          // métricas y lo que traen los casos antiguos y la API entrante.
          agencia: responsable?.nombre ?? dto.agencia?.trim() ?? 'Central',
          agenciaOrigenId: agenciaOrigenId ?? null,
          agenciaResponsableId: responsable?.id ?? null,
          canales: canales.map((c) => c.id),
          lat: typeof dto.lat === 'number' ? dto.lat : null,
          lng: typeof dto.lng === 'number' ? dto.lng : null,
          entidadId: dto.entidadId ?? null,
          estado: 'nuevo',
          creadoPor: usuario,
        }),
      );
      const destino = canales.length ? ` Enviado a ${this.describirDestino(canales, agencias)}.` : '';
      await this.registrar(tenant, caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.${destino}`, usuario, undefined, undefined, manager);
      return caso;
    });
    this.gateway?.emitirNuevo(tenant, guardado);
    return guardado;
  }

  /**
   * Texto del destino agrupado por entidad —«Policía Nacional (C1, C2) y
   * Salud (A1)»—, para que la bitácora diga a quién se envió y no solo unos
   * códigos de canal sueltos.
   */
  private describirDestino(
    canales: Array<{ id: string; codigo: string; agenciaId: string }>,
    agencias: Array<{ id: string; nombre: string }>,
  ): string {
    const nombre = new Map(agencias.map((a) => [a.id, a.nombre]));
    const porAgencia = new Map<string, string[]>();
    for (const c of canales) {
      const lista = porAgencia.get(c.agenciaId) ?? [];
      lista.push(c.codigo);
      porAgencia.set(c.agenciaId, lista);
    }
    const partes = [...porAgencia.entries()].map(
      ([id, codigos]) => `${nombre.get(id) ?? 'agencia desconocida'} (${codigos.join(', ')})`,
    );
    if (partes.length <= 1) return partes[0] ?? '';
    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  }

  /** Busca el código de caso del secad; ignora en silencio uno desconocido. */
  private async tipificar(tenant: string, codigo?: string) {
    if (!codigo?.trim()) return null;
    const buscado = codigo.trim().toUpperCase();
    const todos = await this.catalogos.listarCodigos(tenant);
    return todos.find((c) => c.codigo.toUpperCase() === buscado) ?? null;
  }

  /**
   * Resuelve a quién se envía el caso.
   *
   * Un mismo hecho suele necesitar a varias entidades a la vez —un accidente
   * con heridos es tránsito, salud y policía—, así que los canales pueden ser
   * de agencias distintas. La «responsable» es solo la principal: la que queda
   * denormalizada en el caso y encabeza los reportes. Si el operador no la
   * elige, se toma la del primer canal marcado.
   */
  private async resolverAtencion(tenant: string, dto: CrearCasoDto, sugerida: string | null) {
    // Sin restringir a una agencia: se valida que existan y sean del tenant.
    const canales = await this.catalogos.validarCanales(tenant, dto.canales ?? []);

    const principalId = dto.agenciaResponsableId ?? canales[0]?.agenciaId ?? sugerida;
    if (!principalId) return { responsable: null, canales, agencias: [] };

    const responsable = await this.catalogos.agenciaDe(tenant, principalId);
    // Todas las agencias tocadas, para dejarlo dicho en la bitácora.
    const agencias = await this.catalogos.agenciasDe(tenant, [
      ...new Set([responsable.id, ...canales.map((c) => c.agenciaId)]),
    ]);
    return { responsable, canales, agencias };
  }

  /**
   * Remite el caso a canales de atención: los suma a los actuales (gestión
   * conjunta) o los reemplaza (traslado a otra entidad). Queda en la bitácora
   * con el motivo, para saber por qué cambió de manos.
   */
  async remitir(tenant: string, id: string, dto: RemitirDto, actor: Actor): Promise<CasoEntity> {
    // Con actor: solo se puede remitir lo que se alcanza a ver. Sin esta
    // verificación, el GET ocultaba el caso pero la escritura lo aceptaba.
    const caso = await this.obtener(tenant, id, actor);
    const usuario = actor.sub;
    if (caso.estado === 'cerrado') throw new BadRequestException('El caso está cerrado.');
    if (!dto?.canales?.length) throw new BadRequestException('Indique al menos un canal destino.');

    // Los canales destino pueden ser de varias entidades, igual que al recepcionar.
    const canales = await this.catalogos.validarCanales(tenant, dto.canales);
    const principalId = dto.agenciaResponsableId ?? canales[0]?.agenciaId ?? caso.agenciaResponsableId;
    if (!principalId) throw new BadRequestException('Indique la agencia destino.');
    const agencia = await this.catalogos.agenciaDe(tenant, principalId);
    const agencias = await this.catalogos.agenciasDe(tenant, [
      ...new Set([agencia.id, ...canales.map((c) => c.agenciaId)]),
    ]);

    const previos = caso.canales ?? [];
    const agenciaPrevia = caso.agencia;
    caso.canales = dto.exclusivo
      ? canales.map((c) => c.id)
      : [...new Set([...previos, ...canales.map((c) => c.id)])];
    caso.agenciaResponsableId = agencia.id;
    caso.agencia = agencia.nombre;

    const destino = this.describirDestino(canales, agencias);
    const modo = dto.exclusivo ? `Trasladado de ${agenciaPrevia} a` : 'Remitido además a';
    const motivo = dto.observacion?.trim() ? ` Motivo: ${dto.observacion.trim()}` : '';
    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const guardado = await manager.getRepository(CasoEntity).save(caso);
      await this.registrar(tenant, id, 'derivacion', `${modo} ${destino}.${motivo}`, usuario, undefined, undefined, manager);
      return guardado;
    });
    this.gateway?.emitirCambio(tenant, guardado);
    return guardado;
  }

  /** Instancias a las que se puede remitir un caso (todas menos la propia). */
  tenantsRemitibles(tenant: string): Promise<Array<{ codigo: string; nombre: string }>> {
    return this.tenants.directorio(tenant);
  }

  /**
   * Remite el caso a OTRA jurisdicción (otro tenant): la llamada entró donde
   * no correspondía. Como el modelo es pooled y las referencias del caso
   * (agencia, canales) solo tienen sentido en su propio tenant, no se mueve la
   * fila: el caso original queda `derivado` (mismo estado que usa la
   * derivación libre por PATCH .../estado) y se crea uno nuevo en el tenant
   * destino, con la agencia sin asignar (allá lo tipifican con su propio
   * catálogo). Ambos casos quedan enlazados por id para la trazabilidad, cada
   * uno con su propia entrada de bitácora.
   */
  async remitirATenant(tenant: string, id: string, dto: RemitirTenantDto, actor: Actor): Promise<CasoEntity> {
    await this.obtener(tenant, id, actor); // valida alcance antes de tocar nada
    const destinoCodigo = dto?.tenantDestino?.trim();
    const motivo = dto?.observacion?.trim();
    if (!destinoCodigo) throw new BadRequestException('Indique la instancia destino.');
    if (destinoCodigo === tenant) throw new BadRequestException('El destino debe ser una instancia distinta a la actual.');
    if (!motivo) throw new BadRequestException('Indique el motivo de la remisión.');

    const destino = await this.tenants.porCodigo(destinoCodigo);
    if (!destino) throw new NotFoundException('La instancia destino no existe.');
    this.tenants.asegurarVigente(destino);

    return this.rls.conTenant(tenant, async (em) => {
      const casos = em.getRepository(CasoEntity);
      const caso = await casos.findOne({ where: { tenant, id }, lock: { mode: 'pessimistic_write' } });
      if (!caso) throw new NotFoundException('Caso no encontrado.');
      if (caso.estado === 'cerrado') throw new BadRequestException('El caso está cerrado.');
      if (caso.remitidoATenant) {
        throw new BadRequestException(`Este caso ya fue remitido a otra instancia (${caso.remitidoATenant}).`);
      }

      // El nuevo caso vive en el tenant DESTINO: hay que cambiar app.tenant a
      // mitad de la transacción antes de insertarlo, o RLS lo rechaza (el
      // WITH CHECK sigue exigiendo tenant = app.tenant, y aquí ya no es el
      // mismo). Después se vuelve al de origen para guardar el caso propio.
      await em.query('SELECT set_tenant($1)', [destino.codigo]);
      const nuevo = await casos.save(
        casos.create({
          tenant: destino.codigo,
          canal: caso.canal,
          titulo: caso.titulo,
          descripcion: caso.descripcion,
          ciudadano: caso.ciudadano,
          telefono: caso.telefono,
          direccionLlamante: caso.direccionLlamante,
          codigoCaso: caso.codigoCaso,
          prioridad: caso.prioridad,
          ciudad: caso.ciudad,
          barrio: caso.barrio,
          direccion: caso.direccion,
          lat: caso.lat,
          lng: caso.lng,
          agencia: 'Central',
          agenciaResponsableId: null,
          canales: [],
          estado: 'nuevo',
          creadoPor: `remisión desde ${tenant}`,
          remitidoDeTenant: tenant,
          remitidoDeCasoId: caso.id,
        }),
      );

      // De vuelta al tenant de origen para actualizar el caso propio.
      await em.query('SELECT set_tenant($1)', [tenant]);
      const agenciaPrevia = caso.agencia;
      caso.estado = 'derivado';
      caso.agencia = `Remitido a ${destino.nombre}`;
      caso.remitidoATenant = destino.codigo;
      caso.remitidoACasoId = nuevo.id;
      await casos.save(caso);

      await this.registrar(
        tenant, id, 'derivacion',
        `Remitido a otra jurisdicción: ${destino.nombre} (${destino.codigo}), antes en ${agenciaPrevia}. Motivo: ${motivo}`,
        actor.sub, undefined, undefined, em,
      );
      // La bitácora del caso nuevo vive en el tenant DESTINO otra vez.
      await em.query('SELECT set_tenant($1)', [destino.codigo]);
      await this.registrar(
        destino.codigo, nuevo.id, 'creacion',
        `Caso recibido por remisión desde otra jurisdicción (tenant «${tenant}»). Motivo: ${motivo}`,
        actor.sub, undefined, undefined, em,
      );

      return caso;
    });
  }

  /**
   * Deja constancia de que se necesita reabrir un caso cerrado. No lo reabre:
   * solo registra la solicitud y su motivo para que un supervisor decida.
   */
  async solicitarReapertura(tenant: string, id: string, motivo: string, actor: Actor): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id, actor);
    if (caso.estado !== 'cerrado') throw new BadRequestException('El caso no está cerrado.');
    if (!motivo?.trim()) throw new BadRequestException('Explique por qué debe reabrirse.');
    if (caso.reaperturaSolicitada) throw new BadRequestException('Ya hay una solicitud pendiente para este caso.');

    caso.reaperturaSolicitada = true;
    caso.reaperturaMotivo = motivo.trim();
    caso.reaperturaSolicitadaPor = actor.sub;
    caso.reaperturaSolicitadaEn = new Date();
    return this.rls.conTenant(tenant, async (manager) => {
      const guardado = await manager.getRepository(CasoEntity).save(caso);
      await this.registrar(tenant, id, 'nota', `Solicitud de reapertura: ${motivo.trim()}`, actor.sub, undefined, undefined, manager);
      return guardado;
    });
  }

  /**
   * Reapertura autorizada. Exige el permiso casos.reabrir y un motivo, que
   * queda en la bitácora: es la constancia de quién autorizó y por qué.
   */
  async reabrir(tenant: string, id: string, motivo: string, estado: EstadoCaso, actor: Actor): Promise<CasoEntity> {
    if (actor.rol !== 'superadmin' && !actor.permisos.includes('casos.reabrir')) {
      throw new ForbiddenException('No tiene autorización para reabrir casos.');
    }
    const caso = await this.obtener(tenant, id, actor);
    if (caso.estado !== 'cerrado') throw new BadRequestException('El caso no está cerrado.');
    if (!motivo?.trim()) throw new BadRequestException('Escriba la observación de la reapertura.');
    if (estado === 'cerrado' || !ESTADOS.includes(estado)) throw new BadRequestException('Estado de reapertura inválido.');

    const solicitud = caso.reaperturaSolicitada
      ? ` Atiende la solicitud de ${caso.reaperturaSolicitadaPor}: ${caso.reaperturaMotivo}`
      : '';
    caso.estado = estado;
    caso.reaperturaSolicitada = false;
    caso.reaperturaMotivo = null;
    caso.reaperturaSolicitadaPor = null;
    caso.reaperturaSolicitadaEn = null;
    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const guardado = await manager.getRepository(CasoEntity).save(caso);
      await this.registrar(
        tenant, id, 'estado',
        `Reabierto por ${actor.sub}. Observación: ${motivo.trim()}.${solicitud}`,
        actor.sub, 'cerrado', estado, manager,
      );
      return guardado;
    });
    this.gateway?.emitirCambio(tenant, guardado);
    return guardado;
  }

  /**
   * Marca que alguien se hizo cargo. Al abrir un caso nuevo se asume que se va
   * a gestionar, así que el sistema lo mueve solo y deja constancia de quién
   * lo tomó: el despachador no tiene que acordarse de cambiar el estado.
   */
  async tomar(tenant: string, id: string, actor: Actor): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id, actor);
    if (caso.estado !== 'nuevo') return caso;
    caso.estado = 'en_gestion';
    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const guardado = await manager.getRepository(CasoEntity).save(caso);
      await this.registrar(tenant, id, 'estado', `Tomado por ${actor.sub}.`, actor.sub, 'nuevo', 'en_gestion', manager);
      return guardado;
    });
    this.gateway?.emitirCambio(tenant, guardado);
    return guardado;
  }

  async cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto, actor: Actor): Promise<CasoEntity> {
    // Mismo alcance que la lectura: fuera de sus canales no hay nada que cambiar.
    const caso = await this.obtener(tenant, id, actor);
    if (!ESTADOS.includes(dto.estado)) throw new BadRequestException('Estado inválido.');
    if (dto.estado === 'derivado' && !dto.agencia?.trim()) {
      throw new BadRequestException('Para derivar se requiere la agencia destino.');
    }

    // Cerrar y reabrir son permisos distintos: quien cierra un caso no puede
    // deshacerlo por su cuenta, tiene que pedirle la reapertura a un supervisor.
    const puede = (p: string) => actor.rol === 'superadmin' || actor.permisos.includes(p);
    if (dto.estado === 'cerrado' && !puede('casos.cerrar')) {
      throw new ForbiddenException('No tiene permiso para cerrar casos.');
    }
    if (caso.estado === 'cerrado' && dto.estado !== 'cerrado' && !puede('casos.reabrir')) {
      throw new ForbiddenException(
        'Un caso cerrado solo lo reabre quien tenga esa autorización. Solicite la reapertura a un supervisor.',
      );
    }

    const usuario = actor.sub;
    // 'nuevo' es el estado en que nace un caso, no algo que se pueda elegir:
    // volver atrás borraría el rastro de quién lo tomó.
    if (dto.estado === 'nuevo') {
      throw new BadRequestException('Un caso no se puede devolver a nuevo.');
    }
    // Cerrar exige decir cómo terminó y por qué: es lo que alimenta los reportes.
    // El desenlace se valida contra el catálogo del secad, que cada uno ajusta.
    let cierre: { codigo: string; etiqueta: string } | null = null;
    let tipificacionFinal: { codigo: string; descripcion: string } | null = null;
    if (dto.estado === 'cerrado') {
      cierre = await this.catalogos.cierreVigente(tenant, dto.codigoCierre);
      if (!dto.comentario?.trim()) throw new BadRequestException('Escriba el comentario de cierre.');
      if (dto.codigoCasoFinal?.trim()) {
        tipificacionFinal = await this.tipificar(tenant, dto.codigoCasoFinal);
        if (!tipificacionFinal) throw new BadRequestException('Código de caso inválido.');
      }
    }

    const anterior = caso.estado;
    const agenciaAnterior = caso.agencia;
    const codigoCasoAnterior = caso.codigoCaso;
    caso.estado = dto.estado;
    if (dto.estado === 'cerrado') caso.codigoCierre = cierre!.codigo;
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    const corrigioTipificacion = !!tipificacionFinal && tipificacionFinal.codigo !== codigoCasoAnterior;
    if (corrigioTipificacion) caso.codigoCaso = tipificacionFinal!.codigo;

    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const guardado = await manager.getRepository(CasoEntity).save(caso);
      if (dto.estado === 'derivado' && caso.agencia !== agenciaAnterior) {
        await this.registrar(
          tenant, id, 'derivacion',
          `Derivado de ${agenciaAnterior} a ${caso.agencia}.`, usuario, anterior, dto.estado, manager,
        );
      } else {
        const correccion = corrigioTipificacion
          ? ` Tipificación corregida a ${tipificacionFinal!.codigo} (${tipificacionFinal!.descripcion}).`
          : '';
        await this.registrar(
          tenant, id, 'estado',
          dto.estado === 'cerrado'
            ? `Cerrado como «${cierre!.etiqueta}». ${dto.comentario!.trim()}${correccion}`
            : `Estado: ${this.label(anterior)} → ${this.label(dto.estado)}.`,
          usuario, anterior, dto.estado, manager,
        );
      }
      return guardado;
    });

    // Al cerrar, se liberan automáticamente los recursos aún comprometidos.
    // Aparte: toca `asignaciones`, con su propio conTenant() independiente.
    if (dto.estado === 'cerrado' && anterior !== 'cerrado') {
      await this.despacho.liberarCaso(tenant, id, usuario);
    }

    this.gateway?.emitirCambio(tenant, guardado);
    return guardado;
  }

  /**
   * Nota en la bitácora. Desde la interfaz llega con `actor` y se exige el
   * mismo alcance de la lectura; las integraciones internas (p. ej. enlazar
   * una llamada de la PBX a un caso abierto del mismo número) anotan como
   * sistema, sin actor.
   */
  async agregarNota(tenant: string, casoId: string, texto: string, usuario: string, actor?: Actor): Promise<EventoCasoEntity> {
    await this.obtener(tenant, casoId, actor);
    const t = texto?.trim();
    if (!t) throw new BadRequestException('La nota no puede estar vacía.');
    if (t.length > 1000) throw new BadRequestException('La nota supera los 1000 caracteres.');
    return this.rls.conTenant(tenant, (manager) => this.registrar(tenant, casoId, 'nota', t, usuario, undefined, undefined, manager));
  }

  // ---------------------------------------------------------------------------
  /**
   * `em` es OBLIGATORIO en la práctica: sin él, cae al repositorio inyectado
   * (conexión por fuera de cualquier transacción con `app.tenant` fijado), y
   * RLS rechaza el INSERT. Se mantiene opcional en la firma solo por si algún
   * día casos_eventos deja de tener RLS; hoy TODO llamador real pasa `em`
   * desde dentro de un `this.rls.conTenant(...)`.
   */
  private registrar(
    tenant: string, casoId: string, tipo: TipoEvento, descripcion: string,
    autor: string, estadoAnterior?: EstadoCaso, estadoNuevo?: EstadoCaso, em?: EntityManager,
  ): Promise<EventoCasoEntity> {
    const repo = em ? em.getRepository(EventoCasoEntity) : this.eventos;
    return repo.save(
      repo.create({ tenant, casoId, tipo, descripcion, autor, estadoAnterior, estadoNuevo }),
    );
  }

  private label(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }

  /** Siembra datos de demostración para el tenant 'demo' si aún no tiene casos. */
  private async seed(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      new Logger('Seed').warn(
        'ADVERTENCIA: El seed de datos de demostración se ejecutó en PRODUCCIÓN. ' +
        'Los usuarios sembrados tienen contraseña "demo". ' +
        'Cámbielas inmediatamente desde el módulo de Administración.',
      );
    }
    const ya = await this.rls.conTenant('demo', (manager) => manager.getRepository(CasoEntity).count({ where: { tenant: 'demo' } }));
    if (ya > 0) return;

    const base: Array<Partial<CasoEntity>> = [
      { canal: 'llamada', titulo: 'Riña en vía pública', ciudadano: 'María Gómez', telefono: '3001112233', agencia: 'Policía', estado: 'nuevo' },
      { canal: 'chat', titulo: 'Reporte de semáforo dañado', ciudadano: 'Carlos Ruiz', agencia: 'Tránsito', estado: 'en_gestion' },
      { canal: 'integracion', titulo: 'Alarma activada — comercio', ciudadano: 'Sistema Alarmas', agencia: 'Policía', estado: 'nuevo' },
    ];
    await this.rls.conTenant('demo', async (manager) => {
      const repo = manager.getRepository(CasoEntity);
      for (const b of base) {
        const caso = await repo.save(repo.create({ ...b, tenant: 'demo', descripcion: '', creadoPor: 'seed' }));
        await this.registrar('demo', caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.`, 'seed', undefined, undefined, manager);
        if (b.estado === 'en_gestion') {
          await this.registrar('demo', caso.id, 'estado', 'Estado: Nuevo → En gestión.', 'seed', 'nuevo', 'en_gestion', manager);
        }
      }
    });
  }
}
