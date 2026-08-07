import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgenciaEntity } from './agencia.entity';
import { CanalEntity } from './canal.entity';
import { CodigoCasoEntity } from './codigo-caso.entity';
import { CodigoCierreEntity } from './codigo-cierre.entity';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';
import { ImportacionService } from './importacion.service';
import { ReferenciasService } from './referencias.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgenciaEntity, CanalEntity, CodigoCasoEntity, CodigoCierreEntity])],
  controllers: [CatalogosController],
  providers: [CatalogosService, ImportacionService, ReferenciasService],
  exports: [CatalogosService, ReferenciasService],
})
export class CatalogosModule {}
