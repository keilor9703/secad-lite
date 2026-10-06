import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoSesionEntity } from './video-sesion.entity';
import { VideoChatMensajeEntity } from './video-chat-mensaje.entity';
import { CasoEntity } from '../casos/caso.entity';
import { VideollamadaService } from './videollamada.service';
import { VideollamadaController } from './videollamada.controller';
import { VideollamadaGateway } from './videollamada.gateway';
import { VideoTokenService } from './video-token.service';
import { TurnService } from './turn.service';
import { SmsModule } from '../sms/sms.module';
import { ArchivosModule } from '../archivos/archivos.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Videollamada con el ciudadano: señalización WebRTC, chat, ubicación y
 * grabación. Usa SMS para hacerle llegar el enlace y la capa de archivos para
 * guardar la grabación.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([VideoSesionEntity, VideoChatMensajeEntity, CasoEntity]),
    SmsModule,
    ArchivosModule,
    // Por el JwtService que usa el gateway para identificar al despachador —
    // AuthModule exporta JwtModule, igual que lo toma CasosModule.
    AuthModule,
  ],
  controllers: [VideollamadaController],
  providers: [VideollamadaService, VideollamadaGateway, VideoTokenService, TurnService],
  exports: [VideollamadaService, TurnService],
})
export class VideollamadaModule {}
