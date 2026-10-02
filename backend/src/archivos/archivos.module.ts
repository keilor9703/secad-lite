import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchivoEntity } from './archivo.entity';
import { ArchivoChunkEntity } from './archivo-chunk.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ArchivosService } from './archivos.service';
import { ArchivosController } from './archivos.controller';
import { ArchivosBarridoService } from './archivos.barrido.service';
import { ArchivadoService } from './archivado.service';
import { ArchivadoBarridoService } from './archivado.barrido.service';
import { AlmacenObjetosService } from './almacen-objetos.service';

/**
 * Capa de archivos: adjuntos de caso y grabaciones de videollamada, guardados
 * por trozos en la base (ver ArchivoChunkEntity para por qué en la base y no
 * en disco).
 *
 * Exporta el servicio porque la videollamada lo usa para su grabación.
 *
 * El archivado (ArchivadoService) saca las grabaciones viejas de la base al
 * almacenamiento de objetos sin borrarlas, y es también quien las vuelve a
 * servir: para quien abre una grabación, esté archivada o no, no hay diferencia.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ArchivoEntity, ArchivoChunkEntity, TenantEntity])],
  controllers: [ArchivosController],
  providers: [
    ArchivosService, ArchivosBarridoService,
    AlmacenObjetosService, ArchivadoService, ArchivadoBarridoService,
  ],
  exports: [ArchivosService],
})
export class ArchivosModule {}
