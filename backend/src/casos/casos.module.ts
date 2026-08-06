import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasosController } from './casos.controller';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';
import { DespachoModule } from '../despacho/despacho.module';
import { CatalogosModule } from '../catalogos/catalogos.module';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, EventoCasoEntity]), DespachoModule, CatalogosModule],
  controllers: [CasosController],
  providers: [CasosService],
  exports: [CasosService],
})
export class CasosModule {}
