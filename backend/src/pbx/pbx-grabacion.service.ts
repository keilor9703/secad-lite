import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantRlsService } from '../common/tenant-rls.service';
import { ArchivoEntity } from '../archivos/archivo.entity';
import { ArchivosService } from '../archivos/archivos.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { LlamadaEntity } from './llamada.entity';

/**
 * LA GRABACIÓN DE LA LLAMADA, DESDE LA PLANTA HASTA EL CASO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUIÉN EMPUJA A QUIÉN, Y POR QUÉ
 *
 * La planta SUBE el archivo cuando termina de grabar; FALCON no va a
 * buscarlo. Dos razones:
 *
 *  1. La planta vive detrás del cortafuegos de un servidor cuyo único puerto
 *    abierto hacia fuera es el SIP. FALCON no tiene por dónde entrar a
 *    buscar un archivo, y abrirle un puerto para eso sería abrir una puerta
 *    para leer archivos del servidor.
 *  2. La planta ya sabe hablarle a FALCON: el mismo `curl` con la API key de
 *    la instancia que usa el dialplan para avisar de cada llamada. Un camino
 *    menos que inventar, autenticar y vigilar.
 *
 * Lo manda `MixMonitor` al terminar la grabación, con el script que genera
 * `planta/generador.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS NEGATIVAS QUE SON SITUACIONES NORMALES, NO ERRORES
 *
 *  - **La llamada no está en FALCON.** Pasó con la cola vacía: la central
 *    atendió algo de lo que FALCON nunca se enteró. No hay a qué atarlo.
 *  - **La llamada no quedó en un caso.** El operador contestó y no guardó el
 *    caso. `archivos` no admite archivos sueltos —«todo archivo cuelga de un
 *    caso»— y esa invariante no se rompe por una grabación.
 *
 * En los dos casos se responde con el motivo y **la planta se queda con el
 * archivo**: el script solo borra el suyo cuando FALCON confirma. Así un
 * «todavía no hay caso» no se convierte en una grabación perdida, que es
 * exactamente lo que no puede pasar en una línea de emergencias.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE, PORQUE EL REINTENTO ES LO NORMAL
 *
 * Una subida de varios megabytes por una red mala se corta, y el script
 * reintenta. Si el primer intento sí llegó, el segundo NO duplica: se
 * devuelve la grabación que ya está. El respaldo de eso no es este código
 * sino un único parcial en la base —que excluye los `FALLIDO`, para que un
 * intento cortado no bloquee el que sí va a funcionar—.
 */

/** Lo que se le responde a la planta. Nada de rutas internas ni de bytes. */
export interface VistaGrabacionRecibida {
  archivoId: string;
  casoId: string;
  llamadaId: string;
  bytes: number;
  /** `true` si ya estaba subida: el reintento no duplicó nada. */
  yaEstaba: boolean;
}

/** Lo que se acepta, y a qué tipo corresponde cada extensión. */
const TIPOS: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  gsm: 'audio/x-gsm',
};

@Injectable()
export class PbxGrabacionService {
  private readonly log = new Logger(PbxGrabacionService.name);

  constructor(
    private readonly rls: TenantRlsService,
    private readonly archivos: ArchivosService,
  ) {}

  async recibir(
    tenant: TenantEntity,
    datos: {
      callId?: string;
      nombre?: string;
      tipoMime?: string;
      segundos?: number;
      contenido?: Buffer;
    },
  ): Promise<VistaGrabacionRecibida> {
    const callId = (datos.callId ?? '').trim();
    if (!callId)
      throw new BadRequestException('Falta el callId de la llamada.');
    if (!datos.contenido?.length)
      throw new BadRequestException('La grabación llegó vacía.');

    const nombre = (datos.nombre ?? '').trim() || `llamada-${callId}.wav`;
    const tipoMime = this.tipoDe(nombre, datos.tipoMime);

    const llamada = await this.rls.conTenant(tenant.codigo, (manager) =>
      manager
        .getRepository(LlamadaEntity)
        .findOne({ where: { tenant: tenant.codigo, callId } }),
    );
    if (!llamada) {
      throw new NotFoundException(
        `No hay ninguna llamada con callId «${callId}» en esta instancia. La central grabó algo de ` +
          'lo que FALCON nunca se enteró: revise que el dialplan esté avisando con la API key de ' +
          'ESTA instancia. La planta conserva el archivo.',
      );
    }
    if (!llamada.casoId) {
      throw new ConflictException(
        'Esa llamada no quedó asociada a un caso, y en FALCON no hay archivos sueltos: toda ' +
          'grabación cuelga de un caso. Vincule la llamada a un caso y la planta la volverá a ' +
          'subir; mientras, conserva el archivo.',
      );
    }

    const yaEstaba = await this.grabacionDe(tenant.codigo, llamada.id);
    if (yaEstaba) {
      // El reintento de una subida que sí llegó. No se duplica ni se
      // sobrescribe: los bytes de la primera son los que tienen hash y
      // custodia.
      return this.vista(yaEstaba, true);
    }

    try {
      const archivo = await this.archivos.subirCompleto(
        tenant.codigo,
        {
          casoId: llamada.casoId,
          nombre,
          tipoMime,
          // No es ningún funcionario: lo subió la central. Que se vea quién
          // fue importa cuando alguien pregunte de dónde salió este archivo.
          usuario: 'planta',
          origen: 'GRABACION',
          llamadaId: llamada.id,
          descripcion: this.descripcion(llamada, datos.segundos),
        },
        datos.contenido,
      );
      this.log.log(
        `Grabación de la llamada ${callId} (${tenant.codigo}) guardada en el caso ` +
          `${llamada.casoId}: ${archivo.bytes} bytes.`,
      );
      return this.vista(archivo, false);
    } catch (e) {
      // El único parcial de la base ganó una carrera: dos subidas a la vez de
      // la misma llamada. La que perdió devuelve la que quedó, que es lo que
      // el que reintenta quería saber.
      if (String((e as { code?: string })?.code) === '23505') {
        const ganadora = await this.grabacionDe(tenant.codigo, llamada.id);
        if (ganadora) return this.vista(ganadora, true);
      }
      throw e;
    }
  }

  /** La grabación de esa llamada que ya esté guardada, si hay alguna usable. */
  private grabacionDe(
    tenant: string,
    llamadaId: string,
  ): Promise<ArchivoEntity | null> {
    return this.rls
      .conTenant(tenant, (manager) =>
        manager.getRepository(ArchivoEntity).findOne({
          where: { tenant, llamadaId, origen: 'GRABACION' },
          order: { creadoEn: 'DESC' },
        }),
      )
      .then((a) => (a && a.estado !== 'FALLIDO' ? a : null));
  }

  /**
   * De qué es esta grabación, en una línea que sirva en pantalla.
   *
   * Lleva el número y la hora porque es lo que identifica una llamada para
   * quien la busca meses después, cuando el callId de la central ya no le
   * dice nada a nadie.
   */
  private descripcion(llamada: LlamadaEntity, segundos?: number): string {
    const partes = [`Llamada de ${llamada.numero || 'número desconocido'}`];
    if (llamada.extension) partes.push(`a la extensión ${llamada.extension}`);
    if (segundos && segundos > 0) partes.push(`· ${this.duracion(segundos)}`);
    partes.push(`· grabada por la planta`);
    return partes.join(' ');
  }

  private duracion(segundos: number): string {
    const m = Math.floor(segundos / 60);
    const s = Math.round(segundos % 60);
    return m ? `${m} min ${s} s` : `${s} s`;
  }

  /**
   * El tipo del archivo.
   *
   * Se deriva de la EXTENSIÓN y no se cree el `Content-Type` del que sube,
   * salvo que ya sea de audio: curl manda `application/octet-stream` cuando
   * no reconoce el archivo, y un `octet-stream` guardado como tal no lo
   * reproduce ningún navegador —la grabación estaría ahí y no se podría oír,
   * que es la peor forma de tenerla—.
   */
  private tipoDe(nombre: string, declarado?: string): string {
    const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
    const porExtension = TIPOS[ext];
    if (porExtension) return porExtension;
    const limpio = (declarado ?? '').split(';')[0].trim().toLowerCase();
    if (limpio.startsWith('audio/')) return limpio;
    throw new BadRequestException(
      `No reconozco «${nombre}» como una grabación de audio. Se aceptan: ${Object.keys(TIPOS).join(', ')}.`,
    );
  }

  private vista(a: ArchivoEntity, yaEstaba: boolean): VistaGrabacionRecibida {
    return {
      archivoId: a.id,
      casoId: a.casoId,
      llamadaId: a.llamadaId ?? '',
      bytes: Number(a.bytes ?? 0),
      yaEstaba,
    };
  }
}
