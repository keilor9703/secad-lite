import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntidadEntity } from './entidad.entity';
import { CasoEntity } from '../casos/caso.entity';
import { IntegracionService } from './integracion.service';
import { IntegracionController } from './integracion.controller';
import { CasosModule } from '../casos/casos.module';

/**
 * API entrante: entidades externas (bomberos, salud, alarmas...) radican casos
 * con su API key y consultan su estado. Reutiliza CasosService para crear los
 * casos (canal 'integracion') con bitácora.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EntidadEntity, CasoEntity]), CasosModule],
  controllers: [IntegracionController],
  providers: [IntegracionService],
  exports: [IntegracionService],
})
export class IntegracionModule {}
