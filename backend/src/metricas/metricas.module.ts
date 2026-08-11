import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { LlamadaEntity } from '../pbx/llamada.entity';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, LlamadaEntity])],
  controllers: [MetricasController],
  providers: [MetricasService],
})
export class MetricasModule {}
