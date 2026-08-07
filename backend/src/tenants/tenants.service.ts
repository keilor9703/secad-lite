import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { ESTADOS_SUSCRIPCION, EstadoSuscripcion, INTEGRACIONES, Integracion, PLANES, PlanTenant, TenantEntity } from './tenant.entity';
import { CatalogosService } from '../catalogos/catalogos.service';

/** Cambios que solo hace el dueño de la plataforma. */
export interface ActualizarTenantDto {
  nombre?: string;
  activo?: boolean;
  plan?: PlanTenant;
  suscripcion?: EstadoSuscripcion;
  /** Fecha ISO (yyyy-MM-dd) hasta la que está pagado. */
  vence?: string | null;
  motivoBloqueo?: string | null;
  integraciones?: string[];
}

/**
 * Por qué un tenant no puede operar. `null` = puede.
 */
export type ImpedimentoTenant = { motivo: string } | null;

export interface WaConfigDto {
  phoneNumberId: string | null;
  tokenConfigurado: boolean;
  /** Agencia responsable de los casos que entran por WhatsApp (agencias.id). */
  agenciaResponsableId: string | null;
  /** Canales de esa agencia a los que se envían. */
  canales: string[];
}

export interface CrearTenantDto {
  codigo: string;
  nombre: string;
}

/** Gestión de tenants (instancias). Solo el superadmin la usa. */
@Injectable()
export class TenantsService implements OnModuleInit {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
    private readonly catalogos: CatalogosService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.repo.count())) {
      await this.repo.save(
        this.repo.create({ codigo: 'demo', nombre: 'Municipio Demo', activo: true, apiKey: this.generarApiKey() }),
      );
    }
    // Backfill: cualquier tenant existente sin API key recibe una.
    const sinKey = await this.repo.find({ where: { apiKey: IsNull() } });
    for (const t of sinKey) {
      t.apiKey = this.generarApiKey();
      await this.repo.save(t);
    }
  }

  listar(): Promise<TenantEntity[]> {
    return this.repo.find({ order: { codigo: 'ASC' } });
  }

  /**
   * Comprueba si un tenant puede operar ahora mismo: debe estar activo, con la
   * suscripción no suspendida y sin vencer. Es la puerta del servicio: se
   * verifica al iniciar sesión y en cada petición.
   */
  async impedimento(codigo: string | null | undefined): Promise<ImpedimentoTenant> {
    if (!codigo) return null; // superadmin y rutas sin tenant
    const t = await this.repo.findOne({ where: { codigo } });
    if (!t) return { motivo: 'La instancia no existe.' };
    return this.estadoDe(t);
  }

  /** Igual que impedimento(), pero sobre una entidad ya cargada (evita una segunda consulta). */
  private estadoDe(t: TenantEntity): ImpedimentoTenant {
    if (!t.activo) return { motivo: t.motivoBloqueo || 'La instancia está bloqueada. Contacte al proveedor.' };
    if (t.suscripcion === 'suspendida') {
      return { motivo: t.motivoBloqueo || 'La suscripción está suspendida. Contacte al proveedor.' };
    }
    if (t.vence) {
      // Se compara por día: vence al terminar la fecha indicada.
      const hoy = new Date().toISOString().slice(0, 10);
      if (t.vence < hoy) return { motivo: `La suscripción venció el ${t.vence}. Contacte al proveedor.` };
    }
    return null;
  }

  /**
   * Puerta de las integraciones entrantes (webhooks públicos: PBX, entidades
   * externas, WhatsApp). `SuscripcionGuard` NO protege estas rutas: son
   * `@Public()` porque las llama un sistema externo sin sesión de usuario, y el
   * guard exime toda ruta pública sin distinguir cuáles — por diseño, para no
   * bloquear /auth/login ni /health. Cada servicio público debe llamar esto a
   * mano, con el tenant que ya resolvió (por API key o por phone_number_id),
   * antes de aceptar el evento: si no, un tenant bloqueado/vencido o sin la
   * integración contratada seguiría recibiendo casos indefinidamente.
   */
  asegurarVigente(t: TenantEntity, integracion?: Integracion): void {
    const impedimento = this.estadoDe(t);
    if (impedimento) throw new ForbiddenException(impedimento.motivo);
    if (integracion && t.integraciones && !t.integraciones.includes(integracion)) {
      throw new ForbiddenException(`El módulo de ${integracion} no está habilitado para esta instancia.`);
    }
  }

  /**
   * ¿Está habilitada esta integración para el tenant?
   *
   * Sin lista configurada (nulo) no hay restricción: es el caso de las
   * instancias creadas antes de que existieran los módulos contratables, y
   * dejarlas fuera les cortaría servicios que ya venían usando. Solo una lista
   * explícita restringe.
   */
  async tieneIntegracion(codigo: string, clave: string): Promise<boolean> {
    const t = await this.repo.findOne({ where: { codigo } });
    if (!t?.integraciones) return true;
    return t.integraciones.includes(clave);
  }

  async actualizar(id: string, dto: ActualizarTenantDto): Promise<TenantEntity> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    if (dto.plan && !PLANES.includes(dto.plan)) throw new BadRequestException('Plan inválido.');
    if (dto.suscripcion && !ESTADOS_SUSCRIPCION.includes(dto.suscripcion)) {
      throw new BadRequestException('Estado de suscripción inválido.');
    }
    if (dto.vence && !/^\d{4}-\d{2}-\d{2}$/.test(dto.vence)) {
      throw new BadRequestException('La fecha de vencimiento debe ser aaaa-mm-dd.');
    }
    if (dto.integraciones) {
      const invalida = dto.integraciones.find((i) => !INTEGRACIONES.includes(i as never));
      if (invalida) throw new BadRequestException(`Integración desconocida: ${invalida}.`);
    }
    if (dto.nombre !== undefined) {
      if (!dto.nombre.trim()) throw new BadRequestException('El nombre no puede quedar vacío.');
      t.nombre = dto.nombre.trim();
    }
    if (dto.activo !== undefined) t.activo = dto.activo;
    if (dto.plan !== undefined) t.plan = dto.plan;
    if (dto.suscripcion !== undefined) t.suscripcion = dto.suscripcion;
    if (dto.vence !== undefined) t.vence = dto.vence || null;
    if (dto.motivoBloqueo !== undefined) t.motivoBloqueo = dto.motivoBloqueo?.trim() || null;
    if (dto.integraciones !== undefined) t.integraciones = dto.integraciones;
    return this.repo.save(t);
  }

  async crear(dto: CrearTenantDto): Promise<TenantEntity> {
    const codigo = dto.codigo?.trim().toLowerCase();
    if (!codigo || !dto.nombre?.trim()) throw new BadRequestException('Código y nombre son obligatorios.');
    if (!/^[a-z0-9-]{2,64}$/.test(codigo)) {
      throw new BadRequestException('El código solo admite minúsculas, números y guiones (2-64).');
    }
    if (await this.repo.findOne({ where: { codigo } })) {
      throw new ConflictException('Ya existe un tenant con ese código.');
    }
    return this.repo.save(
      this.repo.create({
        codigo, nombre: dto.nombre.trim(), activo: true, apiKey: this.generarApiKey(),
        // Arranca en prueba de 30 días con las integraciones disponibles.
        plan: 'basico', suscripcion: 'prueba',
        vence: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
        integraciones: ['pbx', 'whatsapp', 'api'],
      }),
    );
  }

  async cambiarActivo(id: string, activo: boolean): Promise<TenantEntity> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    t.activo = activo;
    return this.repo.save(t);
  }

  /** Resuelve un tenant por su API key (integraciones entrantes). */
  async porApiKey(apiKey: string): Promise<TenantEntity | null> {
    if (!apiKey?.trim()) return null;
    return this.repo.findOne({ where: { apiKey: apiKey.trim() } });
  }

  porCodigo(codigo: string): Promise<TenantEntity | null> {
    return this.repo.findOne({ where: { codigo } });
  }

  /** Devuelve (creando si falta) la API key del tenant indicado por su código. */
  async apiKeyDe(codigo: string): Promise<string> {
    const t = await this.porCodigo(codigo);
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    if (!t.apiKey) { t.apiKey = this.generarApiKey(); await this.repo.save(t); }
    return t.apiKey;
  }

  /** Resuelve un tenant por su phone_number_id de WhatsApp (enrutamiento entrante). */
  porWaPhoneNumberId(phoneNumberId: string): Promise<TenantEntity | null> {
    if (!phoneNumberId?.trim()) return Promise.resolve(null);
    return this.repo.findOne({ where: { waPhoneNumberId: phoneNumberId.trim() } });
  }

  /** Configuración WhatsApp del tenant (el token nunca se devuelve, solo si está puesto). */
  async getWaConfig(codigo: string): Promise<WaConfigDto> {
    const t = await this.porCodigo(codigo);
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    return this.waConfigDto(t);
  }

  /**
   * Guarda la configuración WhatsApp del tenant. El token solo se actualiza si
   * viene. `agenciaResponsableId`/`canales` son a quién se envían los casos
   * que entren por este canal — sin ellos, un caso de WhatsApp queda sin
   * canal y solo lo ve un supervisor (casos.ver_todos).
   */
  async setWaConfig(
    codigo: string,
    phoneNumberId?: string,
    accessToken?: string,
    agenciaResponsableId?: string | null,
    canales?: string[],
  ): Promise<WaConfigDto> {
    const t = await this.porCodigo(codigo);
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    if (phoneNumberId !== undefined) {
      const pid = phoneNumberId.trim() || null;
      if (pid) {
        const ya = await this.repo.findOne({ where: { waPhoneNumberId: pid } });
        if (ya && ya.id !== t.id) throw new ConflictException('Ese phone_number_id ya está asignado a otro tenant.');
      }
      t.waPhoneNumberId = pid;
    }
    if (accessToken !== undefined && accessToken.trim()) t.waAccessToken = accessToken.trim();
    if (agenciaResponsableId !== undefined) {
      if (!agenciaResponsableId) {
        t.waAgenciaResponsableId = null;
        t.waCanales = [];
      } else {
        const agencia = await this.catalogos.agenciaDe(codigo, agenciaResponsableId);
        const validos = await this.catalogos.validarCanales(codigo, canales ?? [], agencia.id);
        t.waAgenciaResponsableId = agencia.id;
        t.waCanales = validos.map((c) => c.id);
      }
    }
    await this.repo.save(t);
    return this.waConfigDto(t);
  }

  private waConfigDto(t: TenantEntity): WaConfigDto {
    return {
      phoneNumberId: t.waPhoneNumberId ?? null,
      tokenConfigurado: !!t.waAccessToken,
      agenciaResponsableId: t.waAgenciaResponsableId ?? null,
      canales: t.waCanales ?? [],
    };
  }

  /** Rota (regenera) la API key del tenant. */
  async rotarApiKey(codigo: string): Promise<string> {
    const t = await this.porCodigo(codigo);
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    t.apiKey = this.generarApiKey();
    await this.repo.save(t);
    return t.apiKey;
  }

  private generarApiKey(): string {
    return 'fk_' + randomBytes(24).toString('hex');
  }
}
