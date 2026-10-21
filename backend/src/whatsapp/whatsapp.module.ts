import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MensajeChatEntity } from '../chat/mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { ConversacionWaEntity } from './conversacion.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { CasosModule } from '../casos/casos.module';
import { ArchivosModule } from '../archivos/archivos.module';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Integración con WhatsApp (Cloud API de Meta): webhook entrante, casos de canal
 * 'whatsapp' con su conversación (reutiliza MensajeChatEntity y CasosService) y
 * respuestas del operador. La configuración por tenant vive en TenantsService.
 */
@Module({
  imports: [
    AuditoriaModule,
    TypeOrmModule.forFeature([MensajeChatEntity, CasoEntity, ConversacionWaEntity]),
    CasosModule,
    // El menú de tipificación sale del catálogo de códigos del municipio.
    CatalogosModule,
    // La foto, el audio y el documento que manda el ciudadano van al
    // expediente del caso como cualquier otro adjunto.
    ArchivosModule,
    TenantsModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
