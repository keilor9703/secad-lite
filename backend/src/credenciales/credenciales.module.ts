import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredencialTokenEntity } from './credencial-token.entity';
import { CredencialesService } from './credenciales.service';
import { CorreoService } from '../correo/correo.service';

/**
 * Enlaces de un solo uso y salida de correo. Global porque lo usan usuarios y
 * auth, y porque no tiene estado propio que convenga duplicar.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CredencialTokenEntity])],
  providers: [CredencialesService, CorreoService],
  exports: [CredencialesService, CorreoService],
})
export class CredencialesModule {}
