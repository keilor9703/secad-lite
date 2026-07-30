import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TenantEntity } from './tenant.entity';

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
      this.repo.create({ codigo, nombre: dto.nombre.trim(), activo: true, apiKey: this.generarApiKey() }),
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
  async getWaConfig(codigo: string): Promise<{ phoneNumberId: string | null; tokenConfigurado: boolean }> {
    const t = await this.porCodigo(codigo);
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    return { phoneNumberId: t.waPhoneNumberId ?? null, tokenConfigurado: !!t.waAccessToken };
  }

  /** Guarda la configuración WhatsApp del tenant. El token solo se actualiza si viene. */
  async setWaConfig(codigo: string, phoneNumberId?: string, accessToken?: string): Promise<{ phoneNumberId: string | null; tokenConfigurado: boolean }> {
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
    await this.repo.save(t);
    return { phoneNumberId: t.waPhoneNumberId ?? null, tokenConfigurado: !!t.waAccessToken };
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
