import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request as pedirHttp } from 'node:http';
import { request as pedirHttps } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

/**
 * Almacenamiento de objetos para las grabaciones archivadas.
 *
 * Habla con una URL prefirmada (PAR) de Oracle Object Storage, que es un `PUT`
 * y un `GET` contra una URL y nada más: ni SDK, ni credenciales rotando, ni una
 * dependencia nueva en el proyecto. La URL misma ES la credencial —quien la
 * tenga puede leer y escribir el bucket—, así que vive en el entorno del
 * backend y NUNCA se le entrega al navegador: las descargas pasan por la API.
 *
 * Se usa `node:http(s)` y no `fetch` a propósito. Aquí se suben cientos de
 * megabytes en flujo, con un Content-Length exacto; `fetch` con un cuerpo de
 * flujo decide por su cuenta usar codificación por trozos, que Object Storage
 * rechaza en un PAR.
 */
@Injectable()
export class AlmacenObjetosService {
  private readonly logger = new Logger(AlmacenObjetosService.name);
  private readonly base: string;

  /**
   * Media hora. Una grabación de 400 MB por una subida lenta tarda minutos; lo
   * que este tiempo corta es la conexión que se quedó colgada, para que el
   * barrido nocturno no se quede esperando hasta el día siguiente.
   */
  private readonly TIEMPO_MS = 30 * 60_000;

  constructor(config: ConfigService) {
    this.base = (config.get<string>('ARCHIVO_OBJETOS_URL') ?? '').trim().replace(/\/+$/, '');
  }

  configurado(): boolean { return this.base.length > 0; }

  /**
   * Sube el objeto. `bytes` tiene que ser el tamaño EXACTO de lo que entrega
   * `cuerpo`: va como Content-Length, y si no coincide la petición se queda
   * esperando bytes que no llegan. Por eso quien llama lo saca de la suma real
   * de los trozos y no del acumulado de la fila.
   */
  async subir(objeto: string, bytes: number, cuerpo: AsyncIterable<Buffer>): Promise<void> {
    const res = await this.pedir('PUT', objeto, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes),
    }, cuerpo);
    res.resume();  // hay que drenar la respuesta o el socket queda a medias
    if (!this.exitosa(res.statusCode)) {
      throw new Error(`El almacenamiento rechazó la subida de ${objeto}: HTTP ${res.statusCode}`);
    }
  }

  /** Abre el objeto para leerlo. El flujo es el cuerpo de la respuesta. */
  async leer(objeto: string): Promise<IncomingMessage> {
    const res = await this.pedir('GET', objeto);
    if (!this.exitosa(res.statusCode)) {
      res.resume();
      throw new ServiceUnavailableException(
        `La grabación archivada no está disponible en este momento (HTTP ${res.statusCode}).`);
    }
    return res;
  }

  /** Nombre del objeto de una grabación. Determinista: reintentar sobrescribe. */
  nombreObjeto(tenant: string, id: string, creadoEn: Date): string {
    const f = creadoEn instanceof Date ? creadoEn : new Date(creadoEn);
    const anio = f.getUTCFullYear();
    const mes = String(f.getUTCMonth() + 1).padStart(2, '0');
    return `grabaciones/${tenant}/${anio}/${mes}/${id}.webm`;
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  private exitosa(codigo?: number): boolean {
    return typeof codigo === 'number' && codigo >= 200 && codigo < 300;
  }

  private pedir(
    metodo: string,
    objeto: string,
    cabeceras: Record<string, string> = {},
    cuerpo?: AsyncIterable<Buffer>,
  ): Promise<IncomingMessage> {
    if (!this.configurado()) {
      throw new ServiceUnavailableException('No hay almacenamiento de objetos configurado.');
    }
    // Los segmentos se codifican uno a uno: el nombre lleva barras a propósito
    // (son "carpetas" dentro del bucket) y encodeURIComponent las escaparía.
    const ruta = objeto.split('/').map(encodeURIComponent).join('/');
    const url = new URL(`${this.base}/${ruta}`);
    const pedir = url.protocol === 'http:' ? pedirHttp : pedirHttps;

    return new Promise<IncomingMessage>((resolver, rechazar) => {
      const req: ClientRequest = pedir(url, { method: metodo, headers: cabeceras }, resolver);
      req.setTimeout(this.TIEMPO_MS, () => {
        req.destroy(new Error(`El almacenamiento no respondió en ${this.TIEMPO_MS / 60_000} minutos.`));
      });
      req.on('error', rechazar);
      if (cuerpo) {
        const flujo = Readable.from(cuerpo);
        flujo.on('error', (e) => { req.destroy(e); });
        flujo.pipe(req);
      } else {
        req.end();
      }
    });
  }
}
