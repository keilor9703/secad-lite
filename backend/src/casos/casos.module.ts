import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasosController } from './casos.controller';
import { CasosService } from './casos.service';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity } from './evento.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CasoEntity, EventoCasoEntity])],
  controllers: [CasosController],
  providers: [CasosService],
})
export class CasosModule {}
