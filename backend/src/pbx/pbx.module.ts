import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlamadaEntity } from './llamada.entity';
import { PbxWebhookLogEntity } from './webhook-log.entity';
import { ConfigPbxEntity } from './config-pbx.entity';
import { CasoEntity } from '../casos/caso.entity';
import { PbxService } from './pbx.service';
import { PbxController } from './pbx.controller';
import { PbxGateway } from './pbx.gateway';
import { PbxApiKeyGuard } from './pbx-api-key.guard';
import { PbxWebhookRechazoFilter } from './webhook-rechazo.filter';
import { PbxWebhookExitoInterceptor } from './webhook-exito.interceptor';
import { PbxWebhookLogService } from './webhook-log.service';
import { CasosModule } from '../casos/casos.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AuthModule } from '../auth/auth.module';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { PbxConfigService } from './pbx-config.service';
import { PbxConfigController } from './pbx-config.controller';
import { ZadarmaController } from './zadarma/zadarma.controller';
import { AvisosPbxService } from './avisos.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { PbxSalienteService } from './pbx-saliente.service';

/**
 * Integración con la planta telefónica (PBX). Recibe eventos de llamada por
 * webhook (API key del tenant), mantiene la cola en vivo y crea/enlaza casos al
 * atender. Reutiliza CasosService (crear/enlazar) y TenantsService (API key).
 *
 * Varias plantas, un solo modelo de llamada. Cada proveedor vive en
 * `proveedores/` y declara qué sabe hacer y qué credenciales pide; el camino
 * del aviso —instancia, encendido, firma, traducción, cola, bitácora— es uno
 * solo (`AvisosPbxService`). Cuál atiende a cada instancia lo dice
 * `config_pbx`; el interruptor general sigue siendo la integración `pbx` del
 * tenant.
 */
@Module({
  imports: [
    AuditoriaModule,
    TypeOrmModule.forFeature([LlamadaEntity, CasoEntity, PbxWebhookLogEntity, ConfigPbxEntity]),
    CasosModule,
    TenantsModule,
    AuthModule,
    // Resuelve la extensión de la PBX al username del funcionario.
    UsuariosModule,
  ],
  controllers: [PbxController, PbxConfigController, ZadarmaController],
  providers: [
    PbxService, PbxGateway, PbxApiKeyGuard, PbxWebhookLogService,
    PbxWebhookRechazoFilter, PbxWebhookExitoInterceptor,
    PbxConfigService, PbxCredencialesService, AvisosPbxService, PbxSalienteService,
  ],
  exports: [PbxService],
})
export class PbxModule {}
