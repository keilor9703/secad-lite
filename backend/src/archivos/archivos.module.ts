import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchivoEntity } from './archivo.entity';
import { ArchivoChunkEntity } from './archivo-chunk.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ArchivosService } from './archivos.service';
import { ArchivosController } from './archivos.controller';
import { ArchivosBarridoService } from './archivos.barrido.service';

/**
 * Capa de archivos: adjuntos de caso y grabaciones de videollamada, guardados
 * por trozos en la base (ver ArchivoChunkEntity para por qué en la base y no
 * en disco).
 *
 * Exporta el servicio porque la videollamada lo usa para su grabación.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ArchivoEntity, ArchivoChunkEntity, TenantEntity])],
  controllers: [ArchivosController],
  providers: [ArchivosService, ArchivosBarridoService],
  exports: [ArchivosService],
})
export class ArchivosModule {}
