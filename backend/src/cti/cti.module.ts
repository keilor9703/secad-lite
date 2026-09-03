import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CtiEventoEntity } from './cti-evento.entity';
import { CtiService } from './cti.service';
import { CtiController } from './cti.controller';

/**
 * Integración CTI/YACO (barra embebida). Recibe eventos del backend de esa
 * integración por webhook (API key dedicada del tenant, `ctiApiKey`).
 * Esqueleto a propósito — ver CtiService.
 */
@Module({
  imports: [
    AuditoriaModule,
    TypeOrmModule.forFeature([CtiEventoEntity]),
    TenantsModule,
  ],
  controllers: [CtiController],
  providers: [CtiService],
  exports: [CtiService],
})
export class CtiModule {}
