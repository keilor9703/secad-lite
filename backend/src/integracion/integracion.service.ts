import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { digestApiKey, esDigest } from '../common/secretos';
import { EntidadEntity } from './entidad.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { TenantRlsService } from '../common/tenant-rls.service';

/** Payload que una entidad externa envía para radicar un caso. */
export interface RadicarCasoDto {
  titulo: string;
  descripcion?: string;
  ciudadano?: string;
  telefono?: string;
  agencia?: string;
  lat?: number;
  lng?: number;
  /** Referencia del caso en el sistema de la entidad (para su trazabilidad). */
  referencia?: string;
}

export interface CrearEntidadDto {
  nombre: string;
  /** Agencia responsable de sus casos (agencias.id, catálogo). */
  agenciaResponsableId?: string | null;
  /** Canales de esa agencia a los que se envían. */
  canales?: string[];
}

export interface ActualizarEntidadDto {
  nombre?: string;
  agenciaResponsableId?: string | null;
  canales?: string[];
  activa?: boolean;
}

/**
 * API entrante: entidades externas radican casos en FALCON CAD autenticándose
 * con su API key. Cada caso queda con canal 'integracion', enlazado a la
 * entidad (entidadId) para que esta pueda consultar su estado.
 */
/** Entidad tal como se responde a Administración: sin la clave (ya no existe en claro). */
export type EntidadDto = Omit<EntidadEntity, 'apiKey'> & { apiKey?: string };

@Injectable()
export class IntegracionService implements OnModuleInit {
  constructor(
    @InjectRepository(EntidadEntity) private readonly entidades: Repository<EntidadEntity>,
    private readonly casosSvc: CasosService,
    private readonly tenants: TenantsService,
    private readonly catalogos: CatalogosService,
    private readonly rls: TenantRlsService,
  ) {}

  /** Backfill: las claves guardadas en claro (ek_…) pasan a digest. */
  async onModuleInit(): Promise<void> {
    const todas = await this.entidades.find();
    for (const e of todas) {
      if (e.apiKey && !esDigest(e.apiKey)) {
        e.apiKey = digestApiKey(e.apiKey);
        await this.entidades.save(e);
      }
    }
  }

  // --- API pública (x-api-key) ----------------------------------------------

  /** Radica un caso a nombre de la entidad dueña de la API key. */
  async radicar(apiKey: string, dto: RadicarCasoDto) {
    const entidad = await this.porApiKey(apiKey);
    if (!dto?.titulo?.trim()) throw new BadRequestException('El título es obligatorio.');

    const descripcion = [dto.descripcion?.trim(), dto.referencia?.trim() ? `Referencia externa: ${dto.referencia.trim()}` : '']
      .filter(Boolean).join('\n');

    const caso = await this.casosSvc.crear(
      entidad.tenant,
      {
        canal: 'integracion',
        titulo: dto.titulo.trim(),
        descripcion,
        ciudadano: dto.ciudadano?.trim() || entidad.nombre,
        telefono: dto.telefono?.trim(),
        agencia: dto.agencia?.trim() || entidad.agencia,
        lat: dto.lat,
        lng: dto.lng,
        entidadId: entidad.id,
        // A dónde se envía: lo que se configuró al registrar la entidad. Sin
        // esto el caso queda sin canal y solo lo ve un supervisor.
        agenciaResponsableId: entidad.agenciaResponsableId ?? undefined,
        canales: entidad.canales ?? undefined,
      },
      `entidad:${entidad.nombre}`,
    );
    return { casoId: caso.id, estado: caso.estado, titulo: caso.titulo, creadoEn: caso.creadoEn };
  }

  /** Estado de un caso radicado por la MISMA entidad (seguimiento). */
  async consultar(apiKey: string, casoId: string) {
    const entidad = await this.porApiKey(apiKey);
    // Público, sin sesión: el tenant recién se supo por la API key, así que
    // app.tenant (RLS) se fija dentro de esta transacción.
    const caso = await this.rls.conTenant(entidad.tenant, (manager) =>
      manager.getRepository(CasoEntity).findOne({ where: { tenant: entidad.tenant, id: casoId, entidadId: entidad.id } }),
    );
    if (!caso) throw new NotFoundException('Caso no encontrado para esta entidad.');
    return {
      casoId: caso.id, estado: caso.estado, titulo: caso.titulo,
      agencia: caso.agencia, creadoEn: caso.creadoEn, actualizadoEn: caso.actualizadoEn,
    };
  }

  // --- Gestión (permiso entidades.gestionar) --------------------------------

  /** Entidades del tenant, SIN clave: en la base solo vive su digest. */
  async listar(tenant: string): Promise<EntidadDto[]> {
    const es = await this.entidades.find({ where: { tenant }, order: { nombre: 'ASC' } });
    return es.map((e) => this.sinClave(e));
  }

  /**
   * Registra la entidad. La respuesta trae la API key en claro UNA sola vez:
   * lo guardado es su digest, así que este es el único momento de copiarla.
   */
  async crear(tenant: string, dto: CrearEntidadDto): Promise<EntidadDto> {
    const nombre = dto?.nombre?.trim();
    if (!nombre) throw new BadRequestException('El nombre de la entidad es obligatorio.');
    if (await this.entidades.findOne({ where: { tenant, nombre } })) {
      throw new ConflictException('Ya existe una entidad con ese nombre.');
    }
    const atencion = await this.resolverAtencion(tenant, dto.agenciaResponsableId, dto.canales);
    const clave = this.generarKey();
    const e = await this.entidades.save(
      this.entidades.create({
        tenant, nombre,
        ...atencion,
        apiKey: digestApiKey(clave),
        activa: true,
      }),
    );
    return { ...this.sinClave(e), apiKey: clave };
  }

  async actualizar(tenant: string, id: string, dto: ActualizarEntidadDto): Promise<EntidadDto> {
    const e = await this.obtener(tenant, id);
    if (dto.nombre?.trim()) e.nombre = dto.nombre.trim();
    if (dto.agenciaResponsableId !== undefined || dto.canales !== undefined) {
      const atencion = await this.resolverAtencion(
        tenant,
        dto.agenciaResponsableId !== undefined ? dto.agenciaResponsableId : e.agenciaResponsableId,
        dto.canales !== undefined ? dto.canales : e.canales ?? [],
      );
      e.agencia = atencion.agencia;
      e.agenciaResponsableId = atencion.agenciaResponsableId;
      e.canales = atencion.canales;
    }
    if (typeof dto.activa === 'boolean') e.activa = dto.activa;
    return this.sinClave(await this.entidades.save(e));
  }

  /** Rota la clave; el texto claro viaja SOLO en esta respuesta. */
  async rotarKey(tenant: string, id: string): Promise<EntidadDto> {
    const e = await this.obtener(tenant, id);
    const clave = this.generarKey();
    e.apiKey = digestApiKey(clave);
    await this.entidades.save(e);
    return { ...this.sinClave(e), apiKey: clave };
  }

  /**
   * Copia sin la columna apiKey (que ya solo contiene el digest) y con
   * `canales` normalizado a arreglo: las filas anteriores a la migración de
   * enrutamiento lo tienen en NULL, y ese NULL llegaba tal cual al navegador.
   */
  private sinClave(e: EntidadEntity): EntidadDto {
    const { apiKey: _apiKey, ...resto } = e;
    return { ...resto, canales: resto.canales ?? [] };
  }

  // ---------------------------------------------------------------------------

  /**
   * Resuelve la agencia y los canales del catálogo, igual que en Recepción:
   * si no se indica agencia, la entidad queda sin canal (se conserva por
   * compatibilidad, pero el frontend advierte que así solo la ven los
   * supervisores).
   */
  private async resolverAtencion(tenant: string, agenciaResponsableId?: string | null, canalesIds?: string[]) {
    if (!agenciaResponsableId) {
      return { agencia: 'Central', agenciaResponsableId: null, canales: [] };
    }
    const agencia = await this.catalogos.agenciaDe(tenant, agenciaResponsableId);
    const canales = await this.catalogos.validarCanales(tenant, canalesIds ?? [], agencia.id);
    return { agencia: agencia.nombre, agenciaResponsableId: agencia.id, canales: canales.map((c) => c.id) };
  }

  private async obtener(tenant: string, id: string): Promise<EntidadEntity> {
    const e = await this.entidades.findOne({ where: { tenant, id } });
    if (!e) throw new NotFoundException('Entidad no encontrada.');
    return e;
  }

  private async porApiKey(apiKey: string): Promise<EntidadEntity> {
    if (!apiKey?.trim()) throw new UnauthorizedException('Falta la API key (header x-api-key).');
    const e = await this.entidades.findOne({ where: { apiKey: digestApiKey(apiKey) } });
    if (!e || !e.activa) throw new UnauthorizedException('API key inválida o entidad inactiva.');
    // Bloqueado, suscripción suspendida/vencida, o sin la integración 'api'
    // contratada: esta ruta es pública, así que el guard global no lo revisa.
    const tenant = await this.tenants.porCodigo(e.tenant);
    if (!tenant) throw new UnauthorizedException('API key inválida o entidad inactiva.');
    this.tenants.asegurarVigente(tenant, 'api');
    return e;
  }

  private generarKey(): string {
    return 'ek_' + randomBytes(24).toString('hex');
  }
}
