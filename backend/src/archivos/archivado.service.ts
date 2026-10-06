import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ArchivoEntity } from './archivo.entity';
import { ArchivoChunkEntity } from './archivo-chunk.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { TenantRlsService } from '../common/tenant-rls.service';
import { ArchivosService } from './archivos.service';
import { AlmacenObjetosService } from './almacen-objetos.service';

/** A los cuántos días una grabación sale de la base. */
const DIAS_POR_OMISION = 90;

/**
 * Clave del advisory lock. Las tres réplicas corren el mismo @Cron: sin esto,
 * tres procesos archivarían la misma grabación a la vez y dos de ellos
 * borrarían trozos que el tercero todavía está subiendo.
 */
const LOCK_ARCHIVADO = 1810000000;

/** Cuántas grabaciones se archivan por pasada. Acotado para no monopolizar la red. */
const POR_PASADA = 20;

/**
 * Archiva grabaciones viejas: las SACA de la base sin borrarlas.
 *
 * POR QUÉ EXISTE
 *
 * Las grabaciones viven en `archivos_chunks`, dentro de la base, y la política
 * es que ningún dato se borra nunca. Las dos cosas juntas no caben en 200 GB: a
 * dos horas de grabación por día son ~23 GB al mes. El video solo puede ir en
 * una dirección, que es fuera del servidor.
 *
 * EL ORDEN IMPORTA, Y ES TODO EL DISEÑO
 *
 *   1. Se lee el contenido de la base y se sube al almacenamiento de objetos,
 *      calculando su sha256 al pasar.
 *   2. Se vuelve a BAJAR lo subido y se comprueba que el hash coincida.
 *   3. Solo entonces se liberan los bytes de la base.
 *
 * El paso 2 es el que convierte esto en archivar y no en perder. Subir y borrar
 * confiando en que el `PUT` devolvió 200 es exactamente cómo se pierde
 * evidencia: basta un objeto truncado, un proxy que corta, un bucket que llenó
 * su cuota. Si el paso 2 falla, no se borra nada y la grabación sigue en la base
 * para el intento de mañana.
 *
 * La fila de `archivos` sobrevive siempre: el caso conserva quién grabó, cuándo,
 * cuánto pesaba, dónde está y con qué hash. Lo que sale son los bytes.
 */
@Injectable()
export class ArchivadoService {
  private readonly logger = new Logger(ArchivadoService.name);
  private readonly dias: number;

  constructor(
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    private readonly dataSource: DataSource,
    private readonly rls: TenantRlsService,
    private readonly archivos: ArchivosService,
    private readonly almacen: AlmacenObjetosService,
    config: ConfigService,
  ) {
    const crudo = Number(config.get<string>('ARCHIVO_DIAS') ?? DIAS_POR_OMISION);
    this.dias = Number.isFinite(crudo) && crudo >= 1 ? Math.floor(crudo) : DIAS_POR_OMISION;
  }

  get diasRetencionEnBase(): number { return this.dias; }

  /**
   * ¿Hay a dónde archivar? Sin esto el barrido no hace nada y el disco crece,
   * así que la pantalla de administración tiene que poder decirlo en vez de
   * dejar al administrador mirando un cero sin explicación.
   */
  get almacenConfigurado(): boolean { return this.almacen.configurado(); }

  /**
   * Abre una grabación archivada para servirla. Quien la pide no nota la
   * diferencia con una que sigue en la base: ese es el punto de archivar en un
   * almacenamiento que el servidor sí alcanza.
   */
  abrir(archivo: ArchivoEntity): Promise<IncomingMessage> {
    if (!archivo.objetoRemoto) {
      throw new Error(`El archivo ${archivo.id} está marcado como archivado pero sin objeto remoto.`);
    }
    return this.almacen.leer(archivo.objetoRemoto);
  }

  /**
   * Archiva lo que ya cumplió el plazo, en todas las instancias.
   *
   * Devuelve cuántas archivó. No lanza por una grabación que falle: se registra
   * y se sigue con la siguiente, porque un objeto que hoy no se pudo subir se
   * vuelve a intentar mañana y no hay prisa —lo que no se puede es dejar de
   * archivar las demás por una—.
   */
  async archivarVencidos(): Promise<number> {
    if (!this.almacen.configurado()) {
      this.logger.warn(
        'ARCHIVO_OBJETOS_URL no está configurada: las grabaciones se quedan en la base y el disco crece.');
      return 0;
    }

    // El lock tiene que vivir en UNA conexión: pg_advisory_lock es por sesión, y
    // con el pool cada consulta suelta puede caer en otra. Con el runner propio,
    // lock y trabajo comparten sesión y el unlock libera lo que tomó.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ tomado }] = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS tomado', [LOCK_ARCHIVADO]) as Array<{ tomado: boolean }>;
      if (!tomado) {
        this.logger.log('Otra réplica ya está archivando; esta pasada no hace nada.');
        return 0;
      }

      try {
        return await this.recorrer();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [LOCK_ARCHIVADO]);
      }
    } finally {
      await runner.release();
    }
  }

  private async recorrer(): Promise<number> {
    const instancias = await this.tenants.find({ select: { codigo: true } });
    let total = 0;

    for (const { codigo } of instancias) {
      const candidatos = await this.candidatos(codigo);
      for (const c of candidatos) {
        try {
          await this.archivarUno(codigo, c);
          total++;
        } catch (e) {
          // Se registra y se sigue. Nada se borró: lo que falló fue antes de
          // liberar los bytes, por construcción.
          this.logger.error(`No se pudo archivar ${c.id} (${codigo}): ${(e as Error)?.message}`);
        }
      }
    }

    if (total > 0) this.logger.log(`${total} grabación(es) archivadas fuera de la base.`);
    return total;
  }

  /**
   * Grabaciones cerradas, más viejas que el plazo y todavía con sus bytes aquí.
   *
   * Va por `rls.conTenant` y no por el repositorio inyectado porque `archivos`
   * lleva FORCE ROW LEVEL SECURITY: sin `app.tenant` fijado la consulta no ve
   * NINGUNA fila —no falla, devuelve vacío— y el barrido habría parecido
   * funcionar sin archivar nunca nada.
   */
  private candidatos(tenant: string): Promise<ArchivoEntity[]> {
    const limite = new Date(Date.now() - this.dias * 86_400_000);
    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(ArchivoEntity)
        .createQueryBuilder('a')
        .where('a.tenant = :tenant', { tenant })
        .andWhere('a.origen = :origen', { origen: 'GRABACION' })
        .andWhere('a.estado = :estado', { estado: 'COMPLETO' })
        .andWhere('a."archivadoEn" IS NULL')
        .andWhere('a."creadoEn" < :limite', { limite })
        .orderBy('a."creadoEn"', 'ASC')
        .limit(POR_PASADA)
        .getMany());
  }

  /** Sube, VERIFICA y solo entonces libera. Ver la cabecera de la clase. */
  private async archivarUno(tenant: string, archivo: ArchivoEntity): Promise<void> {
    // El tamaño sale de la suma real de los trozos, no del acumulado de la
    // fila: es lo que va como Content-Length, y si no fuera exacto la subida se
    // quedaría esperando bytes que nunca llegan.
    const bytes = await this.bytesReales(tenant, archivo.id);
    if (bytes <= 0) {
      throw new Error('no tiene contenido en la base; no hay nada que archivar');
    }

    const objeto = this.almacen.nombreObjeto(tenant, archivo.id, archivo.creadoEn);
    const hash = createHash('sha256');
    let subidos = 0;

    const leyendoYHasheando = async function* (this: ArchivadoService) {
      for await (const trozo of this.archivos.leerContenido(tenant, archivo.id)) {
        hash.update(trozo);
        subidos += trozo.length;
        yield trozo;
      }
    }.call(this);

    await this.almacen.subir(objeto, bytes, leyendoYHasheando);
    if (subidos !== bytes) {
      throw new Error(`se leyeron ${subidos} bytes de los ${bytes} esperados`);
    }
    const esperado = hash.digest('hex');

    const comprobado = await this.hashDeLoSubido(objeto);
    if (comprobado.bytes !== bytes || comprobado.sha256 !== esperado) {
      throw new Error(
        `lo subido no coincide con el original (${comprobado.bytes}/${bytes} bytes); no se libera nada`);
    }

    await this.liberar(tenant, archivo.id, objeto, esperado);
    this.logger.log(`Archivada ${archivo.id} (${tenant}, ${bytes} bytes) en ${objeto}.`);
  }

  /** Vuelve a bajar lo subido y lo hashea. Es el paso que hace esto seguro. */
  private async hashDeLoSubido(objeto: string): Promise<{ sha256: string; bytes: number }> {
    const flujo = await this.almacen.leer(objeto);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const trozo of flujo as AsyncIterable<Buffer>) {
      hash.update(trozo);
      bytes += trozo.length;
    }
    return { sha256: hash.digest('hex'), bytes };
  }

  private bytesReales(tenant: string, archivoId: string): Promise<number> {
    return this.rls.conTenant(tenant, async (manager) => {
      const [fila] = await manager.query(
        `SELECT COALESCE(SUM(bytes), 0)::bigint AS total
           FROM archivos_chunks WHERE tenant = $1 AND "archivoId" = $2`,
        [tenant, archivoId]) as Array<{ total: string }>;
      return Number(fila?.total ?? 0);
    });
  }

  /**
   * Libera los bytes y deja la constancia, en UNA transacción: si el borrado de
   * los trozos entrara y la marca no, la grabación quedaría como disponible en
   * la base y vacía. Las dos cosas pasan juntas o no pasa ninguna.
   */
  private liberar(tenant: string, archivoId: string, objeto: string, sha256: string): Promise<void> {
    return this.rls.conTenant(tenant, async (manager) => {
      await manager.getRepository(ArchivoEntity).update(
        { tenant, id: archivoId },
        { estado: 'ARCHIVADO', archivadoEn: new Date(), objetoRemoto: objeto, sha256 },
      );
      await manager.getRepository(ArchivoChunkEntity).delete({ tenant, archivoId });
    });
  }
}
