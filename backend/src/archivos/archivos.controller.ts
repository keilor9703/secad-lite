import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Res,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ArchivosService, MAX_BYTES_CHUNK } from './archivos.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { JwtPayload } from '../auth/auth.service';

/** Lo que entrega multer. Se declara aquí para no depender de @types/multer. */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Archivos de un caso: adjuntos que sube el operador y grabaciones de
 * videollamada. Quien puede ver el caso puede adjuntarle evidencia, igual que
 * puede escribir en su chat interno.
 */
@Permisos('casos.ver')
@Controller()
export class ArchivosController {
  constructor(private readonly archivos: ArchivosService) {}

  /** GET /api/casos/:id/archivos — qué hay adjunto a este caso. */
  @Get('casos/:id/archivos')
  async listar(
    @Tenant() tenant: string,
    @Param('id') casoId: string,
    @PermisosVigentes() permisos: string[],
  ) {
    const lista = await this.archivos.listarPorCaso(tenant, casoId);
    const puedeVerGrabaciones = permisos.includes('*') || permisos.includes('casos.ver_grabaciones');

    // Una grabación de videollamada es material sensible: la misma regla que
    // ya rige las grabaciones de llamada (casos.ver_grabaciones) aplica aquí.
    // Se OMITEN de la lista, no se listan sin poder abrirse: mostrar que
    // existe una grabación a quien no puede verla no le sirve de nada.
    return lista
      .filter((a) => a.origen !== 'GRABACION' || puedeVerGrabaciones)
      .map((a) => ({ ...a, bytes: Number(a.bytes) }));
  }

  /** POST /api/casos/:id/archivos — adjuntar un archivo de una sola vez. */
  @Post('casos/:id/archivos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES_CHUNK } }))
  async subir(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') casoId: string,
    @UploadedFile() file: ArchivoSubido,
    @Body() dto: { descripcion?: string },
  ) {
    if (!file) throw new BadRequestException('No llegó ningún archivo.');

    const archivo = await this.archivos.subirCompleto(
      tenant,
      {
        casoId,
        nombre: file.originalname,
        tipoMime: file.mimetype,
        usuario: actor?.sub ?? 'desconocido',
        descripcion: dto?.descripcion ?? null,
      },
      file.buffer,
    );
    return { ...archivo, bytes: Number(archivo.bytes) };
  }

  /**
   * POST /api/archivos/:id/chunk — un trozo de una subida en curso.
   *
   * Lo llama la grabación cada pocos segundos mientras dura la videollamada.
   * El índice lo pone quien sube y hace la operación idempotente: reintentar
   * un trozo que sí había llegado no lo duplica.
   */
  @Post('archivos/:id/chunk')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES_CHUNK } }))
  async chunk(
    @Tenant() tenant: string,
    @Param('id') archivoId: string,
    @UploadedFile() file: ArchivoSubido,
    @Body() dto: { indice?: string },
  ) {
    if (!file) throw new BadRequestException('No llegó ningún trozo.');
    const indice = Number(dto?.indice);
    if (!Number.isInteger(indice)) throw new BadRequestException('Falta el índice del trozo.');

    const bytes = await this.archivos.anexarChunk(tenant, archivoId, indice, file.buffer);
    return { ok: true, bytes };
  }

  /** POST /api/archivos/:id/finalizar — cierra la subida. */
  @Post('archivos/:id/finalizar')
  async finalizar(@Tenant() tenant: string, @Param('id') archivoId: string) {
    const archivo = await this.archivos.finalizar(tenant, archivoId);
    return { ...archivo, bytes: Number(archivo.bytes) };
  }

  /** GET /api/archivos/:id/contenido — descarga. */
  @Get('archivos/:id/contenido')
  async descargar(
    @Tenant() tenant: string,
    @Param('id') archivoId: string,
    @PermisosVigentes() permisos: string[],
    @Res() res: Response,
  ): Promise<void> {
    const archivo = await this.archivos.obtener(tenant, archivoId);
    if (!archivo) throw new BadRequestException('Archivo no encontrado.');

    if (archivo.origen === 'GRABACION'
        && !(permisos.includes('*') || permisos.includes('casos.ver_grabaciones')))
      throw new ForbiddenException('No autorizado para ver grabaciones.');

    if (archivo.estado === 'FALLIDO')
      throw new BadRequestException('Esa subida quedó incompleta y no tiene contenido.');

    res.setHeader('Content-Type', archivo.tipoMime);
    res.setHeader('Content-Disposition', `inline; filename="${archivo.nombre}"`);
    // Un archivo EN_CURSO todavía está creciendo: anunciar un Content-Length
    // que va a quedarse corto hace que el navegador corte la descarga.
    if (archivo.estado === 'COMPLETO') res.setHeader('Content-Length', String(Number(archivo.bytes)));

    for await (const trozo of this.archivos.leerContenido(tenant, archivoId)) {
      if (!res.write(trozo)) await new Promise((r) => res.once('drain', r));
    }
    res.end();
  }
}
