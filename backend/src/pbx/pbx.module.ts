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
import { PbxSoftphoneService } from './pbx-softphone.service';
import { PlantaAsteriskEntity } from './planta/planta-asterisk.entity';
import { PbxTroncalEntity } from './planta/pbx-troncal.entity';
import { PbxNumeroEntity } from './planta/pbx-numero.entity';
import { PlantaService } from './planta/planta.service';
import { CorreoService } from '../correo/correo.service';
import { PlantaSaludEntity } from './planta/planta-salud.entity';
import { PlantaSaludService } from './planta/planta-salud.service';
import { PlantaSaludBarridoService } from './planta/planta-salud.barrido.service';
import { PlantaController } from './planta/planta.controller';
import { PbxGrabacionService } from './pbx-grabacion.service';
import { ArchivosModule } from '../archivos/archivos.module';

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
    TypeOrmModule.forFeature([
      LlamadaEntity,
      CasoEntity,
      PbxWebhookLogEntity,
      ConfigPbxEntity,
      // Nuestra planta: la infraestructura que provisionamos por municipio.
      PlantaAsteriskEntity,
      PbxTroncalEntity,
      PbxNumeroEntity,
      PlantaSaludEntity,
    ]),
    CasosModule,
    TenantsModule,
    AuthModule,
    // Resuelve la extensión de la PBX al username del funcionario.
    UsuariosModule,
    // La grabación de la llamada entra por donde ya entran los adjuntos: con
    // su permiso, su archivado, su hash y su custodia.
    ArchivosModule,
  ],
  controllers: [
    PbxController,
    PbxConfigController,
    PlantaController,
    ZadarmaController,
  ],
  providers: [
    PbxService,
    PbxGateway,
    PbxApiKeyGuard,
    PbxWebhookLogService,
    PbxWebhookRechazoFilter,
    PbxWebhookExitoInterceptor,
    PbxConfigService,
    PbxCredencialesService,
    AvisosPbxService,
    PbxSalienteService,
    PbxSoftphoneService,
    PlantaService,
    PbxGrabacionService,
    // La vigilancia de las plantas: mide desde fuera y avisa cuando algo
    // deja de estar bien. Sin esto, una troncal caída de madrugada no la
    // descubre nadie hasta que un ciudadano no puede llamar.
    PlantaSaludService,
    PlantaSaludBarridoService,
    // El aviso sale por el mismo camino que los reportes de la mesa.
    CorreoService,
  ],
  exports: [PbxService],
})
export class PbxModule {}
