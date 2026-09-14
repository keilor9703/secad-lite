import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasoEntity } from '../casos/caso.entity';
import { LlamadaEntity } from '../pbx/llamada.entity';
import { MetricasController } from './metricas.controller';
import { MetricasService } from './metricas.service';
import { InformePdfService } from './informe-pdf.service';
import { UsuariosModule } from '../usuarios/usuarios.module';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, LlamadaEntity]), UsuariosModule],
  controllers: [MetricasController],
  providers: [MetricasService, InformePdfService],
})
export class MetricasModule {}
