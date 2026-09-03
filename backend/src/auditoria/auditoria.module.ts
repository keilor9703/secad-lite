import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraAdminEntity } from './bitacora-admin.entity';
import { AuditoriaAdminService } from './auditoria-admin.service';
import { AuditoriaAdminController } from './auditoria-admin.controller';
import { RetencionService } from './retencion.service';
import { EventoCasoEntity } from '../casos/evento.entity';
import { ScheduleModule } from '@nestjs/schedule';

/**
 * Sin dependencias hacia otros módulos de negocio: cualquiera puede importarlo
 * para dejar rastro sin riesgo de ciclos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BitacoraAdminEntity, EventoCasoEntity]),
    ScheduleModule,
  ],
  controllers: [AuditoriaAdminController],
  providers: [AuditoriaAdminService, RetencionService],
  exports: [AuditoriaAdminService],
})
export class AuditoriaModule {}
