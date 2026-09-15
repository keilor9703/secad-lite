import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CasoCanalEntity } from './caso-canal.entity';
import { CasoEntity } from './caso.entity';
import { CasoCanalService } from './caso-canal.service';

/**
 * Sin dependencias hacia otros módulos de negocio, para que tanto CasosModule
 * como DespachoModule puedan importarlo sin cerrar un ciclo (CasosModule ya
 * importa DespachoModule). Mismo criterio que AuditoriaModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CasoCanalEntity, CasoEntity])],
  providers: [CasoCanalService],
  exports: [CasoCanalService],
})
export class CasoCanalModule {}
