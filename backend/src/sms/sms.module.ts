import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigSmsEntity } from './config-sms.entity';
import { SmsService } from './sms.service';
import { SmsGlobalController } from './sms-global.controller';
import { InfobipRemitente } from './infobip.remitente';
import { InalambriaRemitente } from './inalambria.remitente';

/**
 * SMS saliente. Lo usa la videollamada para hacerle llegar el enlace al
 * ciudadano; se exporta para que cualquier otro módulo pueda mandar un SMS sin
 * volver a resolver proveedor ni credenciales.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConfigSmsEntity])],
  controllers: [SmsGlobalController],
  providers: [SmsService, InfobipRemitente, InalambriaRemitente],
  exports: [SmsService],
})
export class SmsModule {}
