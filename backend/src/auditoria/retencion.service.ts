import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BitacoraAdminEntity } from './bitacora-admin.entity';
import { EventoCasoEntity } from '../casos/evento.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { TenantRlsService } from '../common/tenant-rls.service';

@Injectable()
export class RetencionService {
  private readonly logger = new Logger(RetencionService.name);

  constructor(
    @InjectRepository(BitacoraAdminEntity)
    private readonly adminBitacora: Repository<BitacoraAdminEntity>,
    // Repositorio directo (no TenantsService/TenantsModule): AuditoriaModule
    // es deliberadamente independiente de los módulos de negocio, y
    // TenantsModule ya importa AuditoriaModule — importarlo de vuelta sería
    // un ciclo. Aquí solo hace falta el listado de códigos, no el servicio.
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    private readonly config: ConfigService,
    private readonly rls: TenantRlsService,
  ) {}

  /** Purga diaria a las 3 AM: borra eventos más viejos que BITACORA_RETENCION_DIAS días. */
  @Cron('0 3 * * *') // Todos los días a las 3 AM
  async purgar(): Promise<void> {
    const dias = Number(this.config.get('BITACORA_RETENCION_DIAS', '0'));
    if (!dias || dias <= 0) return; // Sin variable, no borra nada

    const corte = new Date();
    corte.setDate(corte.getDate() - dias);

    this.logger.log(`Purga de bitácora: eliminando registros anteriores a ${corte.toISOString()}`);

    // casos_eventos tiene RLS: sin app.tenant fijado, un DELETE sin WHERE por
    // tenant no borra nada (WITH CHECK exige tenant = app.tenant). Se recorre
    // cada tenant y se purga dentro de su propia transacción.
    const tenants = await this.tenants.find({ order: { codigo: 'ASC' } });
    for (const t of tenants) {
      await this.rls.conTenant(t.codigo, (manager) =>
        manager.getRepository(EventoCasoEntity).delete({ tenant: t.codigo, creadoEn: LessThan(corte) }),
      );
    }
    // La bitácora de administración no tiene RLS: un solo borrado alcanza.
    await this.adminBitacora.delete({ creadoEn: LessThan(corte) });
  }
}
