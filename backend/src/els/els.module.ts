import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigElsEntity } from './config-els.entity';
import { ElsService } from './els.service';
import { ElsController } from './els.controller';
import { ElsGlobalController } from './els-global.controller';

/**
 * Geolocalización automática del llamante (Android ELS). Se exporta para que
 * otros módulos —la creación de casos desde la planta, más adelante— puedan
 * consultarla sin volver a resolver credenciales.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ConfigElsEntity])],
  controllers: [ElsController, ElsGlobalController],
  providers: [ElsService],
  exports: [ElsService],
})
export class ElsModule {}
