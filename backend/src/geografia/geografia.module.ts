import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartamentoEntity } from './departamento.entity';
import { MunicipioEntity } from './municipio.entity';
import { GeografiaService } from './geografia.service';
import { GeografiaController } from './geografia.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DepartamentoEntity, MunicipioEntity])],
  controllers: [GeografiaController],
  providers: [GeografiaService],
  exports: [GeografiaService],
})
export class GeografiaModule {}
