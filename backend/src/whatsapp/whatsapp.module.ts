import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MensajeChatEntity } from '../chat/mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { CasosModule } from '../casos/casos.module';
import { TenantsModule } from '../tenants/tenants.module';

/**
 * Integración con WhatsApp (Cloud API de Meta): webhook entrante, casos de canal
 * 'whatsapp' con su conversación (reutiliza MensajeChatEntity y CasosService) y
 * respuestas del operador. La configuración por tenant vive en TenantsService.
 */
@Module({
  imports: [
    AuditoriaModule,
    TypeOrmModule.forFeature([MensajeChatEntity, CasoEntity]),
    CasosModule,
    TenantsModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
