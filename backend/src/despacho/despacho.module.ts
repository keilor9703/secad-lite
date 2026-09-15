import { Module } from '@nestjs/common';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecursoEntity } from './recurso.entity';
import { AsignacionEntity } from './asignacion.entity';
import { CasoEntity } from '../casos/caso.entity';
import { EventoCasoEntity } from '../casos/evento.entity';
import { CasoCanalEntity } from '../casos/caso-canal.entity';
import { CasoCanalModule } from '../casos/caso-canal.module';
import { RecursosService } from './recursos.service';
import { RecursosController } from './recursos.controller';
import { DespachoService } from './despacho.service';
import { DespachoController } from './despacho.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecursoEntity, AsignacionEntity, CasoEntity, EventoCasoEntity, CasoCanalEntity]),
    CasoCanalModule,
    // Los recursos validan su agencia contra el catálogo del secad.
    CatalogosModule,
  ],
  controllers: [RecursosController, DespachoController],
  providers: [RecursosService, DespachoService],
  exports: [RecursosService, DespachoService],
})
export class DespachoModule {}
