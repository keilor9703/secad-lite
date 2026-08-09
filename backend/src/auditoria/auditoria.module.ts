import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BitacoraAdminEntity } from './bitacora-admin.entity';
import { AuditoriaAdminService } from './auditoria-admin.service';
import { AuditoriaAdminController } from './auditoria-admin.controller';

/**
 * Sin dependencias hacia otros módulos de negocio: cualquiera puede importarlo
 * para dejar rastro sin riesgo de ciclos.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BitacoraAdminEntity])],
  controllers: [AuditoriaAdminController],
  providers: [AuditoriaAdminService],
  exports: [AuditoriaAdminService],
})
export class AuditoriaModule {}
