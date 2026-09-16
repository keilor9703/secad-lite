import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Inject, forwardRef, Optional, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, FindOptionsWhere, In, LessThan, MoreThanOrEqual, Not, Repository, Brackets } from 'typeorm';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity, TipoEvento } from './evento.entity';
import { CANALES, EstadoCaso, ESTADOS, PRIORIDADES } from './caso.model';
import { CatalogosService } from '../catalogos/catalogos.service';
import { DespachoService } from '../despacho/despacho.service';
import { TenantsService } from '../tenants/tenants.service';
import { CasoEnVivo, CasosGateway } from './casos.gateway';
import { TenantRlsService } from '../common/tenant-rls.service';

/**
 * Quién actúa. `permisos` son los VIGENTES (resueltos contra la base por
 * PermisosGuard), no los del token. `canales` son las colas que atiende, y
 * definen qué casos puede siquiera ver.
 */
/**
 * Un caso visto DESDE un canal concreto. `estado` viene sustituido por el de
 * ese canal —que es lo que el tablero agrupa— y `enColaDesde` dice cuándo
 * llegó a esa bandeja, que no es lo mismo que cuándo ocurrió el hecho: un caso
 * remitido a bomberos tres horas después empieza a contar para ellos ahí.
 */
export type CasoEnCanal = CasoEntity & { enColaDesde: Date };

export interface Actor {
  sub: string;
  rol: string;
  permisos: string[];
  canales?: string[];
  /** Agencia del funcionario; queda como origen de lo que recepcione. */
  agencia?: string | null;
}
import { CasoCanalEntity } from './caso-canal.entity';
import { CasoCanalService } from './caso-canal.service';
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
  private readonly logger = new Logger(CasosService.name);

  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
    @InjectRepository(EventoCasoEntity)
    private readonly eventos: Repository<EventoCasoEntity>,
    private readonly canales_: CasoCanalService,
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
    opts?: { limite?: number; abiertos?: boolean; desde?: string; hasta?: string; canalId?: string | null; porCanal?: boolean },
  ): Promise<CasoEntity[]> {
    // Vista de bandeja (Despacho): se mira UN canal a la vez y el estado que
    // manda es el de ese canal, no el macro-estado del caso. Consulta y los
    // reportes siguen por el camino de abajo, con el caso completo.
    if (opts?.porCanal) {
      return this.listarPorCanal(tenant, actor, opts);
    }
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

      if (!this.irrestricto(actor) && !actor.permisos.includes('casos.ver_todos')) {
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
            // caso.canales es text[] nativo (migración ConvertirCanalesAArray):
            // pertenencia con ANY(), no LIKE contra texto — eso truena con
            // "operator does not exist: text[] ~~ unknown".
            ids.forEach((id, idx) => {
              qbInner.orWhere(`:id${idx} = ANY(caso.canales)`, { [`id${idx}`]: id });
            });
          }),
        );
        return qb.orderBy('caso.creadoEn', 'DESC').take(limite).getMany();
      }

      // casos.ver_todos sin ser un rol de administración (sin usuarios.gestionar
      // ni roles.gestionar): "todos" pasa a significar "todos los de SU agencia",
      // no los de todo el tenant — un supervisor no tiene por qué ver lo de
      // agencias que no dirige. Sin agencia asignada no ve nada (no "todo"):
      // mismo criterio restrictivo que AlcanceRecursos para el no privilegiado.
      if (!this.irrestricto(actor)) {
        if (!actor.agencia) return [];
        where.agenciaResponsableId = actor.agencia;
      }

      const casos = await repo.find({ where, order: { creadoEn: 'DESC' }, take: limite });
      return casos.filter((c) => this.alcanza(c, actor));
    });
  }

  /**
   * Administra el tenant completo: superadmin, o alguien con `usuarios.gestionar`
   * / `roles.gestionar` (gobierna la organización, no solo despacha casos). Es
   * el único alcance que ve más allá de su propia agencia — mismo criterio que
   * `AlcanceRecursos` en el módulo de Recursos.
   */
  private irrestricto(actor: Actor): boolean {
    return actor.rol === 'superadmin'
      || actor.permisos.includes('usuarios.gestionar')
      || actor.permisos.includes('roles.gestionar');
  }

  // --- Estado por canal ------------------------------------------------------
  //
  // La mecánica (abrir bandejas, cerrar las que salen, recalcular el
  // macro-estado) vive en CasoCanalService, que DespachoService también usa.
  // Aquí queda solo lo que depende de permisos y catálogos.

  /**
   * Adjunta al caso el estado de cada entidad que lo atiende, para que el
   * evento en vivo le sirva a todas las pantallas a la vez: cada tablero se
   * queda con el canal que está mirando. Si falla, se emite el caso sin los
   * estados — un problema al leer la tabla no debe impedir que el tablero se
   * entere de que algo cambió.
   */
  private async conEstadosDeCanal(tenant: string, caso: CasoEntity): Promise<CasoEnVivo> {
    try {
      const filas = await this.rls.conTenant(tenant, (m) => this.canales_.filas(m, tenant, caso.id));
      return Object.assign(caso, {
        canalesEstado: filas.map((f) => ({ canalId: f.canalId, agenciaId: f.agenciaId, estado: f.estado })),
      });
    } catch {
      return caso;
    }
  }

  /**
   * Caso completo con el desglose de estado por entidad, para Consulta: quien
   * supervisa ve de un vistazo cuál entidad ya cerró su parte y cuál sigue
   * trabajando, sin entrar al tablero de cada una. Es la contraparte de
   * `obtenerEnCanal` (que sustituye el estado por el de UN canal, para
   * Despacho): aquí se ve el caso completo y se AGREGA el desglose aparte.
   */
  async obtenerConEstados(tenant: string, id: string, actor?: Actor): Promise<CasoEnVivo> {
    const caso = await this.obtener(tenant, id, actor);
    return this.conEstadosDeCanal(tenant, caso);
  }

  /**
   * Desde qué bandeja se está ejecutando la acción.
   *
   * Lo dice el cliente: es el canal que el despachador tiene abierto. No basta
   * con deducirlo de `actor.canales`, porque un supervisor o un administrador
   * no tienen canal propio —eligen la bandeja con el selector—, y al no
   * encontrarles ninguno la acción se iba por el camino de compatibilidad y
   * movía el MACRO-estado del caso en vez de la fila de su canal. Resultado:
   * abrir un caso desde policía lo marcaba «en gestión» para todo el mundo y
   * cerrarlo lo cerraba para todo el mundo, que es exactamente lo que este
   * rediseño vino a impedir.
   *
   * Se valida igual que la lectura: nadie actúa sobre una bandeja que no puede
   * ver, aunque mande el id a mano.
   */
  private async canalDeAccion(tenant: string, actor: Actor, pedido?: string | null): Promise<string | null> {
    const propio = (actor.canales ?? [])[0] ?? null;
    return this.resolverCanalVista(tenant, actor, pedido ?? propio);
  }

  /**
   * El canal por el que este funcionario mira la bandeja.
   *
   * Regla del sistema: se ve un canal a la vez. Un operador tiene el suyo
   * configurado y no elige; un supervisor o administrador elige con el selector
   * y aquí se verifica que el elegido esté dentro de su alcance — sin esta
   * comprobación, bastaría con cambiar el parámetro de la URL para leer la
   * bandeja de otra entidad.
   */
  private async resolverCanalVista(
    tenant: string,
    actor: Actor,
    pedido?: string | null,
  ): Promise<string | null> {
    const propio = (actor.canales ?? [])[0] ?? null;
    if (!pedido) return propio;
    if (propio === pedido) return pedido;
    if (this.irrestricto(actor)) return pedido;
    if (actor.permisos.includes('casos.ver_todos') && actor.agencia) {
      const canal = (await this.catalogos.listarCanales(tenant, actor.agencia)).find((c) => c.id === pedido);
      return canal ? pedido : null;
    }
    return null;
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
    if (this.irrestricto(actor)) return true;

    // Tener el caso en la propia bandeja alcanza, sin importar de quién sea la
    // agencia «principal». Esta comprobación va PRIMERO a propósito: antes,
    // quien tenía `casos.ver_todos` se resolvía solo contra
    // `agenciaResponsableId`, y un supervisor de bomberos no podía tocar un
    // caso que había entrado por policía aunque estuviera en su propio canal
    // —lo veía en el tablero y la acción se lo negaba—. La agencia principal
    // nombra a UNA entidad; el caso lo atienden varias.
    const mios = new Set(actor.canales ?? []);
    if ((caso.canales ?? []).some((id) => mios.has(id))) return true;

    if (actor.permisos.includes('casos.ver_todos')) return !!actor.agencia && caso.agenciaResponsableId === actor.agencia;
    return caso.creadoPor === actor.sub;
  }

  /**
   * La bandeja de UN canal.
   *
   * Dos consultas en vez de un JOIN a propósito: la primera va directo contra
   * el índice (tenant, canalId, estado) de `casos_canales` y acota el universo
   * al tamaño de la página; la segunda trae esos casos por id. Es más legible
   * que un join con selects crudos, y el plan de ejecución es el que se busca.
   *
   * Lo que sale lleva el `estado` del CANAL, no el del caso: es lo que el
   * tablero agrupa en columnas. Como solo se mira un canal a la vez, no hay
   * ambigüedad posible sobre cuál estado mostrar.
   */
  private async listarPorCanal(
    tenant: string,
    actor: Actor,
    opts: { limite?: number; abiertos?: boolean; desde?: string; hasta?: string; canalId?: string | null },
  ): Promise<CasoEnCanal[]> {
    const canalId = await this.resolverCanalVista(tenant, actor, opts.canalId);
    // Sin canal no hay bandeja: ni el operador sin canal configurado, ni el
    // supervisor que todavía no eligió uno en el selector. Lista vacía, no error.
    if (!canalId) return [];

    return this.rls.conTenant(tenant, async (manager) => {
      const limite = Math.min(Math.max(Math.trunc(opts.limite ?? 200) || 200, 1), 500);
      const qb = manager.getRepository(CasoCanalEntity).createQueryBuilder('cc')
        .where('cc.tenant = :tenant AND cc.canalId = :canalId', { tenant, canalId });
      if (opts.abiertos) qb.andWhere("cc.estado != 'cerrado'");

      const desde = this.fechaValida(opts.desde);
      const hasta = this.fechaValida(opts.hasta);
      const finExclusivo = hasta ? new Date(hasta.getTime() + 864e5) : null;
      if (desde) qb.andWhere('cc.creadoEn >= :desde', { desde });
      if (finExclusivo) qb.andWhere('cc.creadoEn < :hasta', { hasta: finExclusivo });

      const filas = await qb.orderBy('cc.creadoEn', 'DESC').take(limite).getMany();
      if (!filas.length) return [];

      const casos = await manager.getRepository(CasoEntity).find({
        where: { tenant, id: In(filas.map((f) => f.casoId)) },
      });
      const porId = new Map(casos.map((c) => [c.id, c]));

      // El orden lo manda la bandeja del canal, no el de la tabla de casos.
      return filas.flatMap((f) => {
        const caso = porId.get(f.casoId);
        if (!caso) return [];
        return [Object.assign(caso, { estado: f.estado, enColaDesde: f.creadoEn }) as CasoEnCanal];
      });
    });
  }

  /**
   * El caso visto DESDE una bandeja: igual que `obtener`, pero con el estado y
   * el reloj de ese canal en vez de los del caso.
   *
   * Lo usa el panel de gestión cuando vive dentro del tablero. Sin esto, a
   * bomberos se le mostraba «En gestión» porque policía ya lo había tomado,
   * aunque su propia fila siguiera en «nuevo» — y de ahí salía que el panel
   * decidiera mal si tenía que tomar el caso al abrirlo.
   *
   * Devuelve una copia: el caso que se guarda en las escrituras debe conservar
   * su macro-estado real.
   */
  async obtenerEnCanal(tenant: string, id: string, actor: Actor, canal?: string | null): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id, actor);
    const canalId = await this.canalDeAccion(tenant, actor, canal);
    if (!canalId) return caso;
    const fila = await this.rls.conTenant(tenant, (m) => this.canales_.fila(m, tenant, id, canalId));
    if (!fila) return caso;
    return Object.assign(Object.create(Object.getPrototypeOf(caso)), caso, {
      estado: fila.estado,
      enColaDesde: fila.creadoEn,
    });
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
      // Cada canal destino estrena su propia fila en estado `nuevo`: desde aquí
      // cada entidad avanza por su cuenta.
      await this.canales_.abrir(manager, tenant, caso.id, canales);
      const destino = canales.length ? ` Enviado a ${this.describirDestino(canales, agencias)}.` : '';
      await this.registrar(tenant, caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.${destino}`, usuario, undefined, undefined, manager);
      return caso;
    });
    this.gateway?.emitirNuevo(tenant, await this.conEstadosDeCanal(tenant, guardado));
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
      // Gestión conjunta: los canales nuevos estrenan bandeja y los que ya
      // estaban conservan su avance. Traslado exclusivo: a los que salen se
      // les cierra su fila, no se les borra — queda el rastro de que
      // estuvieron y hasta cuándo.
      await this.canales_.abrir(manager, tenant, id, canales);
      if (dto.exclusivo) {
        await this.canales_.retirar(manager, tenant, id, canales.map((c) => c.id));
      }
      await this.registrar(tenant, id, 'derivacion', `${modo} ${destino}.${motivo}`, usuario, undefined, undefined, manager);
      const macro = await this.canales_.sincronizarMacro(manager, tenant, guardado);
      if (macro) {
        await this.registrar(
          tenant, id, 'estado', `Estado: ${this.label(macro.anterior)} → ${this.label(macro.nuevo)}.`,
          usuario, macro.anterior, macro.nuevo, manager,
        );
      }
      return guardado;
    });
    this.gateway?.emitirCambio(tenant, await this.conEstadosDeCanal(tenant, guardado));
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
   * destino. Ambos casos quedan enlazados por id para la trazabilidad, cada
   * uno con su propia entrada de bitácora, y ambos tenants se enteran en vivo
   * (mismo socket que cualquier caso nuevo/actualizado).
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

    // A dónde llega en el tenant destino: lo que ESE tenant configuró para
    // recibir remisiones (Administración → Remisiones entre jurisdicciones),
    // igual mecanismo que WhatsApp/Entidades externas. Si no lo configuró, o
    // si quedó apuntando a una agencia/canal que ya no existe, se degrada a
    // "sin asignar" en vez de tumbar la remisión — el origen no tiene por qué
    // ver frustrado su envío por un catálogo mal mantenido en el destino.
    let agenciaNombre = 'Central';
    let agenciaIdDestino: string | null = null;
    let canalesDestino: string[] = [];
    if (destino.remisionAgenciaResponsableId) {
      try {
        const agencia = await this.catalogos.agenciaDe(destino.codigo, destino.remisionAgenciaResponsableId);
        const canales = await this.catalogos.validarCanales(destino.codigo, destino.remisionCanales ?? [], agencia.id);
        agenciaNombre = agencia.nombre;
        agenciaIdDestino = agencia.id;
        canalesDestino = canales.map((c) => c.id);
      } catch {
        this.logger.warn(`Config de remisión inválida en tenant "${destino.codigo}": agencia/canal ya no existe.`);
      }
    }
    const destinoTxt = canalesDestino.length
      ? `Enviado a ${agenciaNombre}.`
      : 'Sin agencia/canal configurado para remisiones en esta instancia (Administración → Remisiones entre jurisdicciones): queda visible solo para quien tenga "Ver todos los casos", hasta enrutarlo a mano.';

    const [caso, nuevo] = await this.rls.conTenant(tenant, async (em) => {
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
          agencia: agenciaNombre,
          agenciaResponsableId: agenciaIdDestino,
          canales: canalesDestino,
          estado: 'nuevo',
          creadoPor: `remisión desde ${tenant}`,
          remitidoDeTenant: tenant,
          remitidoDeCasoId: caso.id,
        }),
      );

      // Las bandejas del caso nuevo, todavía con app.tenant en el destino: sin
      // ellas, el tablero por canal de esa instancia no lo vería nunca.
      await this.canales_.abrir(
        em, destino.codigo, nuevo.id,
        (canalesDestino ?? []).map((id) => ({ id, agenciaId: agenciaIdDestino! })),
      );

      // De vuelta al tenant de origen para actualizar el caso propio.
      await em.query('SELECT set_tenant($1)', [tenant]);
      // El caso sale de este secad entero: todas las bandejas de aquí quedan
      // como derivadas, no solo la de quien hizo la remisión.
      await this.canales_.marcarTodas(em, tenant, id, 'derivado');
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
        `Caso recibido por remisión desde otra jurisdicción (tenant «${tenant}»). ${destinoTxt} Motivo: ${motivo}`,
        actor.sub, undefined, undefined, em,
      );

      return [caso, nuevo] as const;
    });

    // Ambos tenants se enteran en vivo: el origen ve su caso pasar a
    // "derivado" sin recargar, y el destino ve llegar el caso nuevo — antes
    // esto último no avisaba a nadie; un supervisor solo lo encontraba si
    // se le ocurría ir a buscarlo en Consulta.
    this.gateway?.emitirCambio(tenant, await this.conEstadosDeCanal(tenant, caso));
    this.gateway?.emitirNuevo(destino.codigo, await this.conEstadosDeCanal(destino.codigo, nuevo));
    return caso;
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
    this.gateway?.emitirCambio(tenant, await this.conEstadosDeCanal(tenant, guardado));
    return guardado;
  }

  /**
   * Marca que alguien se hizo cargo. Al abrir un caso nuevo se asume que se va
   * a gestionar, así que el sistema lo mueve solo y deja constancia de quién
   * lo tomó: el despachador no tiene que acordarse de cambiar el estado.
   */
  /**
   * Toma el caso para la entidad de quien lo toma, y solo para ella.
   *
   * Antes esto ponía el caso «en gestión» para todo el mundo: si policía lo
   * tomaba, bomberos lo veía como si ya lo estuvieran atendiendo sin haberlo
   * abierto. Ahora avanza la fila del canal del funcionario; el macro-estado
   * del caso se recalcula después y solo se mueve si de verdad corresponde.
   */
  async tomar(tenant: string, id: string, actor: Actor, canal?: string | null): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id, actor);
    const canalId = await this.canalDeAccion(tenant, actor, canal);

    const guardado = await this.rls.conTenant(tenant, async (manager) => {
      const fila = canalId ? await this.canales_.fila(manager, tenant, id, canalId) : null;

      // Sin canal propio (o un caso sin canales, recepcionado sin destino) se
      // conserva el comportamiento anterior sobre el macro-estado: es el único
      // estado que existe para ese caso.
      if (!fila) {
        if (caso.estado !== 'nuevo') return caso;
        caso.estado = 'en_gestion';
        const g = await manager.getRepository(CasoEntity).save(caso);
        await this.registrar(tenant, id, 'estado', `Tomado por ${actor.sub}.`, actor.sub, 'nuevo', 'en_gestion', manager);
        return g;
      }

      if (fila.estado !== 'nuevo') return caso;
      fila.estado = 'en_gestion';
      await manager.getRepository(CasoCanalEntity).save(fila);
      await this.registrar(
        tenant, id, 'estado_canal', `Tomado por ${actor.sub} para su canal.`,
        actor.sub, 'nuevo', 'en_gestion', manager,
      );

      const macro = await this.canales_.sincronizarMacro(manager, tenant, caso);
      if (macro) {
        await this.registrar(
          tenant, id, 'estado', `Estado: ${this.label(macro.anterior)} → ${this.label(macro.nuevo)}.`,
          actor.sub, macro.anterior, macro.nuevo, manager,
        );
      }
      return caso;
    });
    this.gateway?.emitirCambio(tenant, await this.conEstadosDeCanal(tenant, guardado));
    return guardado;
  }

  async cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto, actor: Actor, canal?: string | null): Promise<CasoEntity> {
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
    // Desde aquí, "el estado actual" es el de la entidad que está actuando: si
    // policía ya cerró lo suyo, es policía quien necesita permiso de reapertura,
    // no bomberos, que sigue con su parte abierta.
    const canalActor = await this.canalDeAccion(tenant, actor, canal);
    const filaActor = canalActor
      ? await this.rls.conTenant(tenant, (m) => this.canales_.fila(m, tenant, id, canalActor))
      : null;
    const estadoActual = filaActor?.estado ?? caso.estado;

    if (estadoActual === 'cerrado' && dto.estado !== 'cerrado' && !puede('casos.reabrir')) {
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

    const anterior = estadoActual;
    const macroAnterior = caso.estado;
    const agenciaAnterior = caso.agencia;
    const codigoCasoAnterior = caso.codigoCaso;
    // La tipificación y la agencia describen el HECHO: son compartidas por
    // todas las entidades y se corrigen en el caso, no en la fila del canal.
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    const corrigioTipificacion = !!tipificacionFinal && tipificacionFinal.codigo !== codigoCasoAnterior;
    if (corrigioTipificacion) caso.codigoCaso = tipificacionFinal!.codigo;

    const correccion = corrigioTipificacion
      ? ` Tipificación corregida a ${tipificacionFinal!.codigo} (${tipificacionFinal!.descripcion}).`
      : '';
    const descripcion = dto.estado === 'cerrado'
      ? `Cerrado como «${cierre!.etiqueta}». ${dto.comentario!.trim()}${correccion}`
      : `Estado: ${this.label(anterior)} → ${this.label(dto.estado)}.`;

    const { guardado, macro } = await this.rls.conTenant(tenant, async (manager) => {
      // Sin fila de canal (caso recepcionado sin destino, o actor sin canal)
      // el macro-estado es el único que existe: se mueve como siempre.
      if (!filaActor) {
        caso.estado = dto.estado;
        if (dto.estado === 'cerrado') caso.codigoCierre = cierre!.codigo;
        const g = await manager.getRepository(CasoEntity).save(caso);
        if (dto.estado === 'derivado' && caso.agencia !== agenciaAnterior) {
          await this.registrar(
            tenant, id, 'derivacion',
            `Derivado de ${agenciaAnterior} a ${caso.agencia}.`, usuario, anterior, dto.estado, manager,
          );
        } else {
          await this.registrar(tenant, id, 'estado', descripcion, usuario, anterior, dto.estado, manager);
        }
        return { guardado: g, macro: { anterior, nuevo: dto.estado } };
      }

      // Avanza SOLO la entidad que actúa.
      filaActor.estado = dto.estado;
      if (dto.estado === 'cerrado') filaActor.codigoCierre = cierre!.codigo;
      await manager.getRepository(CasoCanalEntity).save(filaActor);
      await this.registrar(
        tenant, id, dto.estado === 'derivado' && caso.agencia !== agenciaAnterior ? 'derivacion' : 'estado_canal',
        descripcion, usuario, anterior, dto.estado, manager,
      );

      // Y ahora la regla que sostiene todo esto: el caso solo se cierra cuando
      // TODAS las entidades cerraron lo suyo. Mientras quede una abierta, el
      // macro-estado no llega a `cerrado` y el caso no desaparece de ninguna
      // otra bandeja.
      const cambio = await this.canales_.sincronizarMacro(manager, tenant, caso);
      if (cambio) {
        await this.registrar(
          tenant, id, 'estado', `Estado: ${this.label(cambio.anterior)} → ${this.label(cambio.nuevo)}.`,
          usuario, cambio.anterior, cambio.nuevo, manager,
        );
      }
      return { guardado: caso, macro: cambio };
    });

    // Los recursos son del caso, no de una entidad: se liberan cuando el caso
    // entero se cierra, no cuando la primera agencia termina lo suyo.
    if (macro?.nuevo === 'cerrado' && macroAnterior !== 'cerrado') {
      await this.despacho.liberarCaso(tenant, id, usuario);
    }

    this.gateway?.emitirCambio(tenant, await this.conEstadosDeCanal(tenant, guardado));
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
