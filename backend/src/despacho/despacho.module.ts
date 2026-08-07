import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecursoEntity } from './recurso.entity';
import { AsignacionEntity } from './asignacion.entity';
import { CasoEntity } from '../casos/caso.entity';
import { EventoCasoEntity } from '../casos/evento.entity';
import { RecursosService } from './recursos.service';
import { RecursosController } from './recursos.controller';
import { DespachoService } from './despacho.service';
import { DespachoController } from './despacho.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecursoEntity, AsignacionEntity, CasoEntity, EventoCasoEntity]),
    // Los recursos validan su agencia contra el catálogo del secad.
    CatalogosModule,
  ],
  controllers: [RecursosController, DespachoController],
  providers: [RecursosService, DespachoService],
  exports: [RecursosService, DespachoService],
})
export class DespachoModule {}
