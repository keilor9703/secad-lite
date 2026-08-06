import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity, TipoEvento } from './evento.entity';
import { CANALES, EstadoCaso, ESTADOS, PRIORIDADES } from './caso.model';
import { CatalogosService } from '../catalogos/catalogos.service';
import { DespachoService } from '../despacho/despacho.service';

/** Contexto mínimo del actor (subconjunto del JWT) para auditoría y permisos. */
export interface Actor {
  sub: string;
  rol: string;
  permisos: string[];
  /** Agencia del funcionario; queda como origen de lo que recepcione. */
  agencia?: string | null;
}
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { RemitirDto } from './dto/remitir.dto';

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
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * Bandeja del secad. Con `canalesDelFuncionario` se acota a los casos
   * enviados a esas colas — es la vista de despacho: cada entidad ve lo suyo.
   * El filtrado se hace en memoria porque `canales` se guarda como lista simple
   * y el volumen de un secad lite no lo justifica en SQL.
   */
  async listar(tenant: string, canalesDelFuncionario?: string[]): Promise<CasoEntity[]> {
    const casos = await this.repo.find({ where: { tenant }, order: { creadoEn: 'DESC' } });
    if (!canalesDelFuncionario) return casos;
    const mios = new Set(canalesDelFuncionario);
    return casos.filter((c) => (c.canales ?? []).some((id) => mios.has(id)));
  }

  async obtener(tenant: string, id: string): Promise<CasoEntity> {
    const caso = await this.repo.findOne({ where: { tenant, id } });
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    return caso;
  }

  /** Línea de tiempo de un caso (valida antes que el caso pertenezca al tenant). */
  async listarAuditoria(tenant: string, casoId: string): Promise<EventoCasoEntity[]> {
    await this.obtener(tenant, casoId);
    return this.eventos.find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
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

    const { responsable, canales } = await this.resolverAtencion(tenant, dto, tipificacion?.agenciaSugeridaId ?? null);

    const caso = await this.repo.save(
      this.repo.create({
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
    const destino = canales.length
      ? ` Enviado a ${canales.map((c) => c.codigo).join(', ')} (${responsable?.nombre ?? 'sin agencia'}).`
      : '';
    await this.registrar(tenant, caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.${destino}`, usuario);
    return caso;
  }

  /** Busca el código de caso del secad; ignora en silencio uno desconocido. */
  private async tipificar(tenant: string, codigo?: string) {
    if (!codigo?.trim()) return null;
    const buscado = codigo.trim().toUpperCase();
    const todos = await this.catalogos.listarCodigos(tenant);
    return todos.find((c) => c.codigo.toUpperCase() === buscado) ?? null;
  }

  /**
   * Resuelve a quién se envía el caso: la agencia responsable que eligió el
   * operador (o la sugerida por el código) y los canales de esa agencia. Los
   * canales se validan contra la agencia para que no se cuele la cola de otra.
   */
  private async resolverAtencion(tenant: string, dto: CrearCasoDto, sugerida: string | null) {
    const id = dto.agenciaResponsableId ?? sugerida;
    if (!id) {
      if (dto.canales?.length) throw new BadRequestException('Indique la agencia responsable de los canales.');
      return { responsable: null, canales: [] };
    }
    const responsable = await this.catalogos.agenciaDe(tenant, id);
    const canales = await this.catalogos.validarCanales(tenant, dto.canales ?? [], responsable.id);
    return { responsable, canales };
  }

  /**
   * Remite el caso a canales de atención: los suma a los actuales (gestión
   * conjunta) o los reemplaza (traslado a otra entidad). Queda en la bitácora
   * con el motivo, para saber por qué cambió de manos.
   */
  async remitir(tenant: string, id: string, dto: RemitirDto, usuario: string): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id);
    if (caso.estado === 'cerrado') throw new BadRequestException('El caso está cerrado.');
    if (!dto?.canales?.length) throw new BadRequestException('Indique al menos un canal destino.');

    const destinoId = dto.agenciaResponsableId ?? caso.agenciaResponsableId;
    if (!destinoId) throw new BadRequestException('Indique la agencia destino.');
    const agencia = await this.catalogos.agenciaDe(tenant, destinoId);
    const canales = await this.catalogos.validarCanales(tenant, dto.canales, agencia.id);

    const previos = caso.canales ?? [];
    const agenciaPrevia = caso.agencia;
    caso.canales = dto.exclusivo
      ? canales.map((c) => c.id)
      : [...new Set([...previos, ...canales.map((c) => c.id)])];
    caso.agenciaResponsableId = agencia.id;
    caso.agencia = agencia.nombre;
    const guardado = await this.repo.save(caso);

    const codigos = canales.map((c) => c.codigo).join(', ');
    const modo = dto.exclusivo ? `Trasladado de ${agenciaPrevia} a` : 'Remitido además a';
    const motivo = dto.observacion?.trim() ? ` Motivo: ${dto.observacion.trim()}` : '';
    await this.registrar(tenant, id, 'derivacion', `${modo} ${agencia.nombre} (${codigos}).${motivo}`, usuario);
    return guardado;
  }

  async cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto, actor: Actor): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id);
    if (!ESTADOS.includes(dto.estado)) throw new BadRequestException('Estado inválido.');
    if (dto.estado === 'derivado' && !dto.agencia?.trim()) {
      throw new BadRequestException('Para derivar se requiere la agencia destino.');
    }

    // Cerrar y reabrir requieren el permiso casos.cerrar (superadmin siempre).
    const puedeCerrar = actor.rol === 'superadmin' || actor.permisos.includes('casos.cerrar');
    if (dto.estado === 'cerrado' && !puedeCerrar) {
      throw new ForbiddenException('No tiene permiso para cerrar casos.');
    }
    if (caso.estado === 'cerrado' && dto.estado !== 'cerrado' && !puedeCerrar) {
      throw new ForbiddenException('No tiene permiso para reabrir casos.');
    }

    const usuario = actor.sub;
    const anterior = caso.estado;
    const agenciaAnterior = caso.agencia;
    caso.estado = dto.estado;
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    const guardado = await this.repo.save(caso);

    // Al cerrar, se liberan automáticamente los recursos aún comprometidos.
    if (dto.estado === 'cerrado' && anterior !== 'cerrado') {
      await this.despacho.liberarCaso(tenant, id, usuario);
    }

    if (dto.estado === 'derivado' && caso.agencia !== agenciaAnterior) {
      await this.registrar(
        tenant, id, 'derivacion',
        `Derivado de ${agenciaAnterior} a ${caso.agencia}.`, usuario, anterior, dto.estado,
      );
    } else {
      await this.registrar(
        tenant, id, 'estado',
        `Estado: ${this.label(anterior)} → ${this.label(dto.estado)}.`, usuario, anterior, dto.estado,
      );
    }
    return guardado;
  }

  async agregarNota(tenant: string, casoId: string, texto: string, usuario: string): Promise<EventoCasoEntity> {
    await this.obtener(tenant, casoId);
    const t = texto?.trim();
    if (!t) throw new BadRequestException('La nota no puede estar vacía.');
    if (t.length > 1000) throw new BadRequestException('La nota supera los 1000 caracteres.');
    return this.registrar(tenant, casoId, 'nota', t, usuario);
  }

  // ---------------------------------------------------------------------------
  private registrar(
    tenant: string, casoId: string, tipo: TipoEvento, descripcion: string,
    autor: string, estadoAnterior?: EstadoCaso, estadoNuevo?: EstadoCaso,
  ): Promise<EventoCasoEntity> {
    return this.eventos.save(
      this.eventos.create({ tenant, casoId, tipo, descripcion, autor, estadoAnterior, estadoNuevo }),
    );
  }

  private label(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }

  /** Siembra datos de demostración para el tenant 'demo' si aún no tiene casos. */
  private async seed(): Promise<void> {
    const ya = await this.repo.count({ where: { tenant: 'demo' } });
    if (ya > 0) return;

    const base: Array<Partial<CasoEntity>> = [
      { canal: 'llamada', titulo: 'Riña en vía pública', ciudadano: 'María Gómez', telefono: '3001112233', agencia: 'Policía', estado: 'nuevo' },
      { canal: 'chat', titulo: 'Reporte de semáforo dañado', ciudadano: 'Carlos Ruiz', agencia: 'Tránsito', estado: 'en_gestion' },
      { canal: 'integracion', titulo: 'Alarma activada — comercio', ciudadano: 'Sistema Alarmas', agencia: 'Policía', estado: 'nuevo' },
    ];
    for (const b of base) {
      const caso = await this.repo.save(this.repo.create({ ...b, tenant: 'demo', descripcion: '', creadoPor: 'seed' }));
      await this.registrar('demo', caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.`, 'seed');
      if (b.estado === 'en_gestion') {
        await this.registrar('demo', caso.id, 'estado', 'Estado: Nuevo → En gestión.', 'seed', 'nuevo', 'en_gestion');
      }
    }
  }
}
