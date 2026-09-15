import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFile, statfs } from 'fs/promises';
import * as os from 'os';
import Redis from 'ioredis';

/**
 * Una medida que puede no existir. Todo lo que se lee del sistema operativo o
 * de un servicio externo puede fallar sin que eso sea un error de la
 * aplicación: un contenedor sin cgroup v2, un Postgres tras un pooler que
 * esconde pg_stat_activity, un Redis no configurado. En vez de reventar la
 * respuesta entera, cada sonda dice si pudo medir y por qué no.
 */
export type Medida<T> = { disponible: true; valor: T } | { disponible: false; motivo: string };

const si = <T>(valor: T): Medida<T> => ({ disponible: true, valor });
const no = (motivo: string): Medida<never> => ({ disponible: false, motivo });

/**
 * De dónde salió un número de consumo. Importa de verdad: dentro de un
 * contenedor, `os.totalmem()` reporta la memoria de la MÁQUINA ANFITRIONA, no
 * el límite del contenedor — en Render, eso puede ser "16 GB libres" mientras
 * el proceso se muere a los 512 MB. La interfaz muestra esta procedencia para
 * que nadie decida sobre un número que mide otra cosa de la que cree.
 */
export type Fuente = 'cgroup-v2' | 'cgroup-v1' | 'sistema';

export interface Consumo {
  usadoBytes: number;
  totalBytes: number;
  porcentaje: number;
  fuente: Fuente;
}

export interface Infraestructura {
  cpu: Medida<{ porcentaje: number; nucleos: number; fuente: Fuente }>;
  memoria: Medida<Consumo>;
  disco: Medida<{ usadoBytes: number; totalBytes: number; porcentaje: number; ruta: string }>;
  proceso: {
    uptimeSegundos: number;
    rssBytes: number;
    heapUsadoBytes: number;
    heapTotalBytes: number;
    versionNode: string;
    plataforma: string;
  };
  /** Verdadero si se detectaron límites de contenedor: cambia cómo se lee todo lo demás. */
  contenedor: boolean;
}

export interface Salud {
  api: { ok: true; uptimeSegundos: number; entorno: string };
  base: Medida<{
    latenciaMs: number;
    tamanoBytes: Medida<number>;
    conexiones: Medida<{ enUso: number; maximo: number }>;
    version: Medida<string>;
  }>;
  redis: Medida<{ memoriaBytes: number; clientes: number; version: string }>;
}

/** Lee un archivo de /sys/fs/cgroup; `null` si no existe (no es un contenedor, u otra versión). */
async function leerCgroup(ruta: string): Promise<string | null> {
  try {
    return (await readFile(ruta, 'utf8')).trim();
  } catch {
    return null;
  }
}

@Injectable()
export class InfraestructuraService {
  private readonly log = new Logger(InfraestructuraService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  // --- Infraestructura -----------------------------------------------------

  async infraestructura(): Promise<Infraestructura> {
    const [cpu, memoria, disco] = await Promise.all([this.cpu(), this.memoria(), this.disco()]);
    const mem = process.memoryUsage();
    return {
      cpu,
      memoria,
      disco,
      proceso: {
        uptimeSegundos: Math.round(process.uptime()),
        rssBytes: mem.rss,
        heapUsadoBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        versionNode: process.version,
        plataforma: `${os.platform()} ${os.arch()}`,
      },
      contenedor:
        (memoria.disponible && memoria.valor.fuente !== 'sistema') ||
        (cpu.disponible && cpu.valor.fuente !== 'sistema'),
    };
  }

  /**
   * Memoria REAL disponible para el proceso. Se prefiere el límite del cgroup
   * sobre `os.totalmem()` por la razón explicada en `Fuente`: en un contenedor
   * los números del sistema operativo describen una máquina que no es la
   * nuestra.
   */
  private async memoria(): Promise<Medida<Consumo>> {
    try {
      // cgroup v2 (Docker moderno, Render, Kubernetes actuales).
      const [max, actual] = await Promise.all([
        leerCgroup('/sys/fs/cgroup/memory.max'),
        leerCgroup('/sys/fs/cgroup/memory.current'),
      ]);
      // "max" literal = sin límite: el contenedor puede usar toda la máquina,
      // así que el dato útil vuelve a ser el del sistema.
      if (max && actual && max !== 'max') {
        const total = Number(max);
        const usado = Number(actual);
        if (total > 0 && Number.isFinite(usado)) return si(this.consumo(usado, total, 'cgroup-v2'));
      }

      // cgroup v1 (Docker antiguo). Su "sin límite" es un número gigante.
      const [lim, uso] = await Promise.all([
        leerCgroup('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
        leerCgroup('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
      ]);
      if (lim && uso) {
        const total = Number(lim);
        const usado = Number(uso);
        if (total > 0 && total < Number.MAX_SAFE_INTEGER / 2 && Number.isFinite(usado)) {
          return si(this.consumo(usado, total, 'cgroup-v1'));
        }
      }

      const total = os.totalmem();
      return si(this.consumo(total - os.freemem(), total, 'sistema'));
    } catch (e) {
      return no(`No se pudo leer la memoria: ${(e as Error).message}`);
    }
  }

  private consumo(usadoBytes: number, totalBytes: number, fuente: Fuente): Consumo {
    return {
      usadoBytes,
      totalBytes,
      porcentaje: totalBytes > 0 ? Math.round((usadoBytes / totalBytes) * 1000) / 10 : 0,
      fuente,
    };
  }

  /**
   * CPU en uso. En cgroup v2 se mide de verdad: dos muestras de `cpu.stat`
   * separadas en el tiempo dan el consumo real del contenedor contra su cuota.
   * Fuera de un contenedor no hay cuota que medir, así que se cae a la carga
   * del sistema normalizada por núcleos — que es una aproximación, y se marca
   * como tal con la fuente.
   */
  private async cpu(): Promise<Medida<{ porcentaje: number; nucleos: number; fuente: Fuente }>> {
    const nucleos = os.cpus().length || 1;
    try {
      const cuota = await this.cuotaCpu();
      const primera = await this.usoCpuMicros();
      if (cuota !== null && primera !== null) {
        const ventanaMs = 120;
        await new Promise((r) => setTimeout(r, ventanaMs));
        const segunda = await this.usoCpuMicros();
        if (segunda !== null) {
          // Microsegundos de CPU consumidos frente a los disponibles en la ventana.
          const consumidos = segunda - primera;
          const disponibles = ventanaMs * 1000 * cuota;
          const pct = disponibles > 0 ? (consumidos / disponibles) * 100 : 0;
          return si({
            porcentaje: Math.round(Math.min(Math.max(pct, 0), 100) * 10) / 10,
            nucleos: cuota,
            fuente: 'cgroup-v2',
          });
        }
      }

      // Sin cgroup: la carga del último minuto repartida entre los núcleos.
      // En Windows y macOS `loadavg()` devuelve ceros — ahí no hay nada que medir.
      const carga = os.loadavg()[0];
      if (carga === 0 && os.platform() !== 'linux') {
        return no('La carga del sistema no está disponible en esta plataforma.');
      }
      return si({
        porcentaje: Math.round(Math.min((carga / nucleos) * 100, 100) * 10) / 10,
        nucleos,
        fuente: 'sistema',
      });
    } catch (e) {
      return no(`No se pudo medir la CPU: ${(e as Error).message}`);
    }
  }

  /** Núcleos efectivos que el cgroup permite usar; `null` si no hay cuota fijada. */
  private async cuotaCpu(): Promise<number | null> {
    const max = await leerCgroup('/sys/fs/cgroup/cpu.max');
    if (!max) return null;
    const [cuota, periodo] = max.split(/\s+/);
    if (!cuota || cuota === 'max') return null;
    const p = Number(periodo) || 100_000;
    const c = Number(cuota);
    return Number.isFinite(c) && c > 0 ? c / p : null;
  }

  /** Microsegundos de CPU consumidos por el contenedor desde que arrancó. */
  private async usoCpuMicros(): Promise<number | null> {
    const stat = await leerCgroup('/sys/fs/cgroup/cpu.stat');
    if (!stat) return null;
    const linea = stat.split('\n').find((l) => l.startsWith('usage_usec'));
    if (!linea) return null;
    const n = Number(linea.split(/\s+/)[1]);
    return Number.isFinite(n) ? n : null;
  }

  private async disco(): Promise<Medida<{ usadoBytes: number; totalBytes: number; porcentaje: number; ruta: string }>> {
    const ruta = process.cwd();
    try {
      const fs = await statfs(ruta);
      const total = Number(fs.blocks) * Number(fs.bsize);
      // `bavail` (y no `bfree`) es lo que de verdad puede usar el proceso: parte
      // del espacio libre está reservado para el superusuario.
      const libre = Number(fs.bavail) * Number(fs.bsize);
      const usado = total - libre;
      return si({
        usadoBytes: usado,
        totalBytes: total,
        porcentaje: total > 0 ? Math.round((usado / total) * 1000) / 10 : 0,
        ruta,
      });
    } catch (e) {
      return no(`No se pudo leer el disco: ${(e as Error).message}`);
    }
  }

  // --- Salud ---------------------------------------------------------------

  async salud(): Promise<Salud> {
    const [base, redis] = await Promise.all([this.base(), this.redis()]);
    return {
      api: {
        ok: true,
        uptimeSegundos: Math.round(process.uptime()),
        entorno: this.config.get<string>('NODE_ENV', 'development'),
      },
      base,
      redis,
    };
  }

  /**
   * Estado de Postgres. Lo único que se da por garantizado es el ping: el
   * tamaño, las conexiones y la versión se piden por separado y cada uno puede
   * faltar — detrás del pooler de Supabase, `pg_stat_activity` solo muestra las
   * conexiones del propio rol, y algunos proveedores restringen más todavía.
   */
  private async base(): Promise<Salud['base']> {
    const inicio = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
    } catch (e) {
      return no(`Sin conexión con la base: ${(e as Error).message}`);
    }
    const latenciaMs = Date.now() - inicio;

    const [tamanoBytes, conexiones, version] = await Promise.all([
      this.consulta<number>(
        'SELECT pg_database_size(current_database()) AS v',
        (filas) => Number(filas[0].v),
        'El proveedor no permite consultar el tamaño de la base.',
      ),
      this.consulta<{ enUso: number; maximo: number }>(
        `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS en_uso,
                (SELECT setting FROM pg_settings WHERE name = 'max_connections') AS maximo`,
        (filas) => ({ enUso: Number(filas[0].en_uso), maximo: Number(filas[0].maximo) }),
        'El proveedor no expone el conteo de conexiones.',
      ),
      this.consulta<string>(
        'SHOW server_version',
        (filas) => String(filas[0].server_version),
        'No se pudo leer la versión del servidor.',
      ),
    ]);

    return si({ latenciaMs, tamanoBytes, conexiones, version });
  }

  private async consulta<T>(sql: string, mapear: (filas: any[]) => T, siFalla: string): Promise<Medida<T>> {
    try {
      const filas = await this.dataSource.query(sql);
      if (!filas?.length) return no(siFalla);
      return si(mapear(filas));
    } catch (e) {
      this.log.debug(`Sonda no disponible (${sql.slice(0, 40)}…): ${(e as Error).message}`);
      return no(siFalla);
    }
  }

  /**
   * Redis es opcional en esta aplicación (ver RedisIoAdapter y el
   * ThrottlerModule): sin REDIS_URL el sistema funciona igual, con el conteo en
   * memoria y sin difusión entre instancias. Que no esté no es una falla, así
   * que se informa como "no configurado" y no como servicio caído.
   */
  private async redis(): Promise<Salud['redis']> {
    const url = this.config.get<string>('REDIS_URL')?.trim();
    if (!url) return no('No configurado: el sistema opera en una sola instancia.');

    let cliente: Redis | undefined;
    try {
      cliente = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      await cliente.connect();
      const info = await cliente.info();
      const dato = (clave: string): string => info.match(new RegExp(`^${clave}:(.*)$`, 'm'))?.[1]?.trim() ?? '';
      return si({
        memoriaBytes: Number(dato('used_memory')) || 0,
        clientes: Number(dato('connected_clients')) || 0,
        version: dato('redis_version') || 'desconocida',
      });
    } catch (e) {
      return no(`Configurado pero sin respuesta: ${(e as Error).message}`);
    } finally {
      // Esta conexión es de diagnóstico y muere aquí: dejarla viva sumaría un
      // cliente a Redis por cada refresco de la pantalla.
      try { cliente?.disconnect(); } catch { /* ya estaba cerrada */ }
    }
  }
}
