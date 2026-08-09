import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlamadaEntity } from './llamada.entity';
import { CasoEntity } from '../casos/caso.entity';
import { PbxService } from './pbx.service';
import { PbxController } from './pbx.controller';
import { PbxGateway } from './pbx.gateway';
import { CasosModule } from '../casos/casos.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';

/**
 * Integración con la planta telefónica (PBX). Recibe eventos de llamada por
 * webhook (API key del tenant), mantiene la cola en vivo y crea/enlaza casos al
 * atender. Reutiliza CasosService (crear/enlazar) y TenantsService (API key).
 */
@Module({
  imports: [
    AuditoriaModule,
    TypeOrmModule.forFeature([LlamadaEntity, CasoEntity]),
    CasosModule,
    TenantsModule,
    AuthModule,
    // Resuelve la extensión de la PBX al username del funcionario.
    UsuariosModule,
  ],
  controllers: [PbxController],
  providers: [PbxService, PbxGateway],
  exports: [PbxService],
})
export class PbxModule {}
