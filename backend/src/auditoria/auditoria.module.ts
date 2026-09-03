import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraAdminEntity } from './bitacora-admin.entity';
import { AuditoriaAdminService } from './auditoria-admin.service';
import { AuditoriaAdminController } from './auditoria-admin.controller';
import { RetencionService } from './retencion.service';
import { EventoCasoEntity } from '../casos/evento.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * Sin dependencias hacia otros módulos de negocio: cualquiera puede importarlo
 * para dejar rastro sin riesgo de ciclos. TenantEntity se registra directo
 * (TypeOrmModule.forFeature, no TenantsModule) por lo mismo: TenantsModule ya
 * importa este módulo, e importarlo de vuelta sería un ciclo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BitacoraAdminEntity, EventoCasoEntity, TenantEntity]),
    ScheduleModule,
  ],
  controllers: [AuditoriaAdminController],
  providers: [AuditoriaAdminService, RetencionService],
  exports: [AuditoriaAdminService],
})
export class AuditoriaModule {}
