import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasosController } from './casos.controller';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';
import { DespachoModule } from '../despacho/despacho.module';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, EventoCasoEntity]), DespachoModule],
  controllers: [CasosController],
  providers: [CasosService],
  exports: [CasosService],
})
export class CasosModule {}
