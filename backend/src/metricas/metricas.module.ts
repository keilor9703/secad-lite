import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity])],
  controllers: [MetricasController],
  providers: [MetricasService],
})
export class MetricasModule {}
