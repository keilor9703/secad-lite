import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgenciaEntity } from './agencia.entity';
import { CanalEntity } from './canal.entity';
import { CodigoCasoEntity } from './codigo-caso.entity';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgenciaEntity, CanalEntity, CodigoCasoEntity])],
  controllers: [CatalogosController],
  providers: [CatalogosService],
  exports: [CatalogosService],
})
export class CatalogosModule {}
