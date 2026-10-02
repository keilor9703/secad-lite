import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArchivoEntity, EstadoArchivo, OrigenArchivo, estaCerrado } from './archivo.entity';
import { ArchivoChunkEntity } from './archivo-chunk.entity';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantEntity } from '../tenants/tenant.entity';

/** Tamaño máximo de un archivo completo. */
const MAX_BYTES_ARCHIVO = 512 * 1024 * 1024;

/** Tamaño máximo de un trozo. Debe ir de la mano del límite del body parser. */
export const MAX_BYTES_CHUNK = 25 * 1024 * 1024;

/**
 * Un archivo EN_CURSO que lleva este tiempo sin recibir trozos se da por
 * abandonado: el puesto que lo estaba subiendo murió. No se borra —lo subido
 * es evidencia y puede ser justo lo que importa— se marca para que no quede
 * como una subida eternamente en curso.
 */
const MINUTOS_ABANDONO = 5;

/** Tipos que se aceptan. Todo lo demás se rechaza antes de tocar la base. */
const MIME_PERMITIDOS = [
  'image/', 'video/', 'audio/', 'application/pdf', 'text/plain',
];

@Injectable()
export class ArchivosService {
  private readonly logger = new Logger(ArchivosService.name);

  constructor(
    @InjectRepository(ArchivoEntity) private readonly archivos: Repository<ArchivoEntity>,
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    private readonly rls: TenantRlsService,
  ) {}

  /**
   * Abre un archivo vacío al que luego se le anexan trozos. Es el camino de la
   * grabación: se abre al empezar a grabar, no al terminar, para que lo que se
   * alcance a subir quede guardado aunque nadie llegue a cerrarlo.
   */
  async crear(
    tenant: string,
    datos: {
      casoId: string;
      nombre: string;
      tipoMime: string;
      usuario: string;
      origen?: OrigenArchivo;
      descripcion?: string | null;
      videoSesionId?: string | null;
    },
  ): Promise<ArchivoEntity> {
    if (!datos.casoId) throw new BadRequestException('Falta el caso.');
    this.validarMime(datos.tipoMime);

    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(ArchivoEntity).save(
        manager.getRepository(ArchivoEntity).create({
          tenant,
          casoId: datos.casoId,
          nombre: this.nombreSeguro(datos.nombre),
          tipoMime: datos.tipoMime,
          usuario: datos.usuario,
          origen: datos.origen ?? 'ADJUNTO',
          descripcion: datos.descripcion ?? null,
          videoSesionId: datos.videoSesionId ?? null,
          bytes: '0',
          estado: 'EN_CURSO',
        }),
      ),
    );
  }

  /**
   * Anexa un trozo. Es idempotente por (archivo, índice): si el navegador
   * reintenta un envío que en realidad sí llegó, el trozo no se duplica y el
   * tamaño no se infla — con una grabación reintentando sobre una red mala,
   * duplicar sería lo normal, no la excepción.
   *
   * Devuelve los bytes que tiene el archivo tras el trozo.
   */
  async anexarChunk(tenant: string, archivoId: string, indice: number, datos: Buffer): Promise<number> {
    if (!Number.isInteger(indice) || indice < 0) throw new BadRequestException('Índice de trozo inválido.');
    if (!datos?.length) return this.bytesDe(tenant, archivoId);
    if (datos.length > MAX_BYTES_CHUNK) throw new PayloadTooLargeException('El trozo supera el tamaño máximo.');

    return this.rls.conTenant(tenant, async (manager) => {
      const repoArchivo = manager.getRepository(ArchivoEntity);
      const archivo = await repoArchivo.findOne({ where: { tenant, id: archivoId } });
      if (!archivo) throw new NotFoundException('Archivo no encontrado.');
      // `estaCerrado` y no `=== 'COMPLETO'`: un archivo ARCHIVADO ya no tiene
      // sus bytes en la base, y anexarle un trozo lo dejaría con un trozo
      // suelto que no es ni la grabación vieja ni una nueva.
      if (estaCerrado(archivo.estado)) throw new BadRequestException('El archivo ya está cerrado.');

      const actuales = Number(archivo.bytes ?? 0);
      if (actuales + datos.length > MAX_BYTES_ARCHIVO)
        throw new PayloadTooLargeException('El archivo alcanzó el tamaño máximo permitido.');

      // ON CONFLICT DO NOTHING sobre (tenant, archivoId, indice): el reintento
      // de un trozo que ya entró no inserta nada y no suma bytes.
      const res: Array<unknown> = await manager.query(
        `INSERT INTO archivos_chunks (id, tenant, "archivoId", indice, datos, bytes, "creadoEn")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tenant, "archivoId", indice) DO NOTHING
         RETURNING id`,
        [tenant, archivoId, indice, datos, datos.length],
      );

      // Sin filas devueltas, el trozo ya estaba: no se toca el acumulado.
      if (!res?.length) return actuales;

      const total = actuales + datos.length;
      await repoArchivo.update(
        { tenant, id: archivoId },
        { bytes: String(total), ultimoChunkEn: new Date() },
      );
      return total;
    });
  }

  /**
   * Cierra el archivo. Idempotente: si ya estaba cerrado devuelve lo que hay,
   * porque quien sube puede cerrar dos veces (el usuario oprime Detener y
   * además se dispara el cierre al desmontar el componente).
   */
  async finalizar(tenant: string, archivoId: string): Promise<ArchivoEntity> {
    return this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(ArchivoEntity);
      const archivo = await repo.findOne({ where: { tenant, id: archivoId } });
      if (!archivo) throw new NotFoundException('Archivo no encontrado.');
      if (estaCerrado(archivo.estado)) return archivo;

      // Sin un solo trozo no hay archivo que ofrecer: se marca FALLIDO para
      // que no aparezca en la lista como algo descargable que da un cero.
      const estado: EstadoArchivo = Number(archivo.bytes ?? 0) > 0 ? 'COMPLETO' : 'FALLIDO';
      await repo.update({ tenant, id: archivoId }, { estado, completadoEn: new Date() });
      return { ...archivo, estado, completadoEn: new Date() };
    });
  }

  /** Sube un archivo de una sola vez (el caso del adjunto normal). */
  async subirCompleto(
    tenant: string,
    datos: { casoId: string; nombre: string; tipoMime: string; usuario: string; descripcion?: string | null },
    contenido: Buffer,
  ): Promise<ArchivoEntity> {
    if (!contenido?.length) throw new BadRequestException('El archivo está vacío.');
    const archivo = await this.crear(tenant, datos);

    // Se parte en trozos del tamaño máximo para no meter un bytea gigante en
    // una sola fila: el límite de una fila es alto pero la memoria del proceso
    // al leerla, no.
    let indice = 0;
    for (let pos = 0; pos < contenido.length; pos += MAX_BYTES_CHUNK) {
      await this.anexarChunk(tenant, archivo.id, indice++, contenido.subarray(pos, pos + MAX_BYTES_CHUNK));
    }
    return this.finalizar(tenant, archivo.id);
  }

  listarPorCaso(tenant: string, casoId: string): Promise<ArchivoEntity[]> {
    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(ArchivoEntity).find({
        where: { tenant, casoId },
        order: { creadoEn: 'DESC' },
      }),
    );
  }

  obtener(tenant: string, archivoId: string): Promise<ArchivoEntity | null> {
    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(ArchivoEntity).findOne({ where: { tenant, id: archivoId } }),
    );
  }

  /**
   * Devuelve el contenido en orden. Se entrega trozo a trozo (async iterator)
   * y no como un Buffer único: una grabación de media hora son cientos de
   * megabytes, y armarla entera en memoria para mandarla tumbaría el proceso
   * con dos descargas simultáneas.
   */
  async *leerContenido(tenant: string, archivoId: string): AsyncGenerator<Buffer> {
    // El cursor no puede vivir dentro de rls.conTenant: esa transacción se
    // cierra al volver, y aquí hay que seguir leyendo mientras el cliente
    // descarga. Se pagina por índice, fijando el tenant en cada tanda.
    let desde = -1;
    for (;;) {
      const tanda: Array<{ indice: number; datos: Buffer }> = await this.rls.conTenant(tenant, (manager) =>
        manager
          .getRepository(ArchivoChunkEntity)
          .createQueryBuilder('c')
          .select(['c.indice AS indice', 'c.datos AS datos'])
          .where('c.tenant = :tenant AND c."archivoId" = :archivoId AND c.indice > :desde', {
            tenant, archivoId, desde,
          })
          .orderBy('c.indice', 'ASC')
          .limit(4)
          .getRawMany(),
      );

      if (!tanda.length) return;
      for (const fila of tanda) {
        desde = fila.indice;
        yield fila.datos;
      }
    }
  }

  /**
   * Marca como FALLIDOS los archivos que llevan rato sin recibir trozos y
   * nadie cerró. Lo llama una tarea programada; ver ArchivosBarridoService.
   *
   * Va tenant por tenant y NO con el repositorio inyectado: `archivos` lleva
   * FORCE ROW LEVEL SECURITY, así que una consulta sin `app.tenant` fijado no
   * ve NINGUNA fila —no falla, simplemente no actualiza nada— y el barrido
   * habría parecido funcionar sin hacer nada nunca.
   */
  async barrerAbandonados(): Promise<number> {
    const limite = new Date(Date.now() - MINUTOS_ABANDONO * 60_000);
    const tenants = await this.tenantsConSubidasEnCurso();
    if (!tenants.length) return 0;

    const porTenant = await this.rls.porCadaTenant(tenants, async (manager) => {
      const res = await manager
        .createQueryBuilder()
        .update(ArchivoEntity)
        .set({ estado: 'FALLIDO', completadoEn: () => 'NOW()' })
        .where('estado = :estado', { estado: 'EN_CURSO' })
        .andWhere('COALESCE("ultimoChunkEn", "creadoEn") < :limite', { limite })
        .execute();
      return res.affected ?? 0;
    });

    const n = porTenant.reduce((suma, x) => suma + x.valor, 0);
    if (n > 0) this.logger.warn(`${n} subida(s) abandonada(s) marcadas como fallidas.`);
    return n;
  }

  /**
   * Los códigos de todas las instancias. El barrido tiene que visitarlas una a
   * una: no hay forma de preguntar «¿quién tiene subidas en curso?» sin fijar
   * antes el tenant, porque esa consulta también pasa por RLS y no vería nada.
   * Es el mismo camino que usa el módulo Plataforma para agregar; `tenants` no
   * lleva RLS y se lee de una sola vez.
   */
  private async tenantsConSubidasEnCurso(): Promise<string[]> {
    const instancias = await this.tenants.find({ select: { codigo: true } });
    return instancias.map((t) => t.codigo);
  }

  // ── Ayudas ────────────────────────────────────────────────────────────────

  private async bytesDe(tenant: string, archivoId: string): Promise<number> {
    const a = await this.obtener(tenant, archivoId);
    return Number(a?.bytes ?? 0);
  }

  private validarMime(tipoMime: string): void {
    const t = (tipoMime ?? '').toLowerCase();
    if (!MIME_PERMITIDOS.some((p) => t.startsWith(p)))
      throw new BadRequestException(`Tipo de archivo no permitido: ${tipoMime}`);
  }

  /**
   * Deja el nombre en algo que se puede devolver en una cabecera y guardar sin
   * sorpresas: sin rutas, sin saltos de línea (que permitirían inyectar
   * cabeceras en la descarga) y acotado.
   */
  private nombreSeguro(nombre: string): string {
    const limpio = (nombre ?? 'archivo')
      .replace(/[\\/]/g, '_')
      .replace(/[\r\n"]/g, '')
      .trim();
    return (limpio || 'archivo').slice(0, 200);
  }
}
