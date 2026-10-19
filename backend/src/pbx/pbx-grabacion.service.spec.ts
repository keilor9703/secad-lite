import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PbxGrabacionService } from './pbx-grabacion.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { ArchivosService } from '../archivos/archivos.service';
import { ArchivoEntity } from '../archivos/archivo.entity';
import { LlamadaEntity } from './llamada.entity';
import { TenantEntity } from '../tenants/tenant.entity';

/**
 * La grabación de la llamada, desde la planta hasta el caso.
 *
 * Lo que se protege:
 *
 *  1. **Que quede atada a la llamada Y al caso**, con `origen = GRABACION`:
 *     de ahí salen solos el permiso `casos.ver_grabaciones`, el archivado, el
 *     hash y la custodia. Un archivo subido como adjunto normal se le
 *     enseñaría a cualquier operador.
 *  2. **Que el reintento no duplique.** Subir varios megabytes por una red
 *     mala se corta, y el script reintenta: si el primer intento sí llegó, el
 *     segundo tiene que devolver la que está, no una copia. Pero un intento
 *     FALLIDO no puede bloquear al que sí va a funcionar.
 *  3. **Que las dos negativas normales se expliquen y no se confundan con un
 *     error.** «La llamada no está en FALCON» y «la llamada no quedó en un
 *     caso» son situaciones que pasan, y en las dos la planta tiene que
 *     saber que conserva el archivo.
 *  4. **Que el tipo sea de audio de verdad.** curl manda
 *     `application/octet-stream` cuando no reconoce el archivo, y una
 *     grabación guardada así no la reproduce ningún navegador: estaría ahí y
 *     no se podría oír, que es la peor forma de tenerla.
 */
describe('PbxGrabacionService', () => {
  const TENANT = { codigo: 'itagui' } as TenantEntity;
  const WAV = Buffer.from('RIFF....WAVEfmt ');

  let llamadas: Partial<LlamadaEntity>[];
  let archivos: Partial<ArchivoEntity>[];
  let subidas: {
    tenant: string;
    datos: Record<string, unknown>;
    bytes: number;
  }[];
  let fallaConCodigo: string | null;
  /** Lo que pasa en la base justo antes de que falle la inserción. */
  let alFallar: (() => void) | null;
  let svc: PbxGrabacionService;

  beforeEach(() => {
    llamadas = [
      {
        id: 'll-1',
        tenant: 'itagui',
        callId: 'asterisk-123',
        numero: '+573001234567',
        extension: '101',
        casoId: 'caso-1',
      },
    ];
    archivos = [];
    subidas = [];
    fallaConCodigo = null;
    alFallar = null;

    const manager = {
      getRepository: (entidad: unknown) => {
        const datos: Partial<{ id: string }>[] =
          entidad === LlamadaEntity
            ? (llamadas as Partial<{ id: string }>[])
            : (archivos as Partial<{ id: string }>[]);
        return {
          findOne: async (o: { where?: Record<string, unknown> } = {}) =>
            datos.find((f) =>
              Object.entries(o.where ?? {}).every(
                ([k, v]) => (f as Record<string, unknown>)[k] === v,
              ),
            ) ?? null,
        };
      },
    } as unknown as EntityManager;

    const rls = {
      conTenant: <T>(_t: string, fn: (m: EntityManager) => Promise<T>) =>
        fn(manager),
    } as unknown as TenantRlsService;

    const archivosSvc = {
      subirCompleto: async (
        tenant: string,
        datos: Record<string, unknown>,
        contenido: Buffer,
      ) => {
        if (fallaConCodigo) {
          alFallar?.();
          const e = new Error('duplicado') as Error & { code?: string };
          e.code = fallaConCodigo;
          throw e;
        }
        subidas.push({ tenant, datos, bytes: contenido.length });
        const guardado: Partial<ArchivoEntity> = {
          id: `arch-${archivos.length + 1}`,
          tenant,
          casoId: String(datos['casoId']),
          llamadaId: (datos['llamadaId'] as string) ?? null,
          origen: 'GRABACION',
          estado: 'COMPLETO',
          bytes: String(contenido.length),
        };
        archivos.push(guardado);
        return guardado as ArchivoEntity;
      },
    } as unknown as ArchivosService;

    svc = new PbxGrabacionService(rls, archivosSvc);
  });

  /** El motivo que llega al que sube. Es lo único que puede leer la planta. */
  async function motivoDe(promesa: Promise<unknown>): Promise<string> {
    try {
      await promesa;
      return '';
    } catch (e) {
      return (e as Error)?.message ?? '';
    }
  }

  const subir = (cambios: Record<string, unknown> = {}) =>
    svc.recibir(TENANT, {
      callId: 'asterisk-123',
      nombre: 'asterisk-123.mp3',
      tipoMime: 'audio/mpeg',
      segundos: 95,
      contenido: WAV,
      ...cambios,
    });

  describe('el camino normal', () => {
    it('la guarda en el caso de la llamada, como GRABACION y atada a la llamada', async () => {
      const r = await subir();
      expect(subidas).toHaveLength(1);
      expect(subidas[0].datos).toEqual(
        expect.objectContaining({
          casoId: 'caso-1',
          origen: 'GRABACION',
          llamadaId: 'll-1',
          usuario: 'planta',
          tipoMime: 'audio/mpeg',
          nombre: 'asterisk-123.mp3',
        }),
      );
      expect(r.casoId).toBe('caso-1');
      expect(r.llamadaId).toBe('ll-1');
      expect(r.yaEstaba).toBe(false);
      expect(r.bytes).toBe(WAV.length);
    });

    it('la describe con el número y la duración, que es lo que sirve meses después', async () => {
      await subir();
      const d = String(subidas[0].datos['descripcion']);
      expect(d).toContain('+573001234567');
      expect(d).toContain('101');
      expect(d).toContain('1 min 35 s');
      expect(d).toContain('planta');
    });

    it('sin duración no inventa una', async () => {
      await subir({ segundos: undefined });
      expect(String(subidas[0].datos['descripcion'])).not.toContain('min');
    });
  });

  describe('el reintento', () => {
    it('no duplica: devuelve la que ya está', async () => {
      const primera = await subir();
      const segunda = await subir();
      expect(subidas).toHaveLength(1);
      expect(segunda.archivoId).toBe(primera.archivoId);
      expect(segunda.yaEstaba).toBe(true);
    });

    it('un intento FALLIDO no bloquea al que sí va a funcionar', async () => {
      archivos.push({
        id: 'arch-roto',
        tenant: 'itagui',
        casoId: 'caso-1',
        llamadaId: 'll-1',
        origen: 'GRABACION',
        estado: 'FALLIDO',
        bytes: '0',
      });
      const r = await subir();
      expect(subidas).toHaveLength(1);
      expect(r.yaEstaba).toBe(false);
    });

    it('si dos subidas corren a la vez, la que pierde devuelve la que quedó', async () => {
      // El orden real importa, y una prueba que lo invierta no prueba nada:
      // cuando esta subida empezó, la ganadora NO estaba —si estuviera, la
      // búsqueda previa la habría encontrado y no habría llegado a insertar—.
      // Aparece mientras esta insertaba, y por eso el único la rechaza.
      alFallar = () =>
        archivos.push({
          id: 'arch-ganadora',
          tenant: 'itagui',
          casoId: 'caso-1',
          llamadaId: 'll-1',
          origen: 'GRABACION',
          estado: 'COMPLETO',
          bytes: '1234',
        });
      fallaConCodigo = '23505';
      const r = await svc.recibir(TENANT, {
        callId: 'asterisk-123',
        nombre: 'x.mp3',
        contenido: WAV,
      });
      expect(r.archivoId).toBe('arch-ganadora');
      expect(r.yaEstaba).toBe(true);
    });

    it('otro error de la base no se disfraza de reintento', async () => {
      fallaConCodigo = '23503';
      await expect(subir()).rejects.toThrow('duplicado');
    });
  });

  describe('las dos negativas que son normales', () => {
    it('la llamada no está en FALCON: lo dice y recuerda que la planta conserva el archivo', async () => {
      llamadas = [];
      await expect(subir()).rejects.toThrow(NotFoundException);
      const e = await motivoDe(subir());
      expect(e).toContain('asterisk-123');
      expect(e).toContain('API key');
      expect(e).toContain('conserva el archivo');
    });

    it('la llamada no quedó en un caso: no rompe la invariante de que todo archivo cuelga de uno', async () => {
      llamadas[0].casoId = null;
      await expect(subir()).rejects.toThrow(ConflictException);
      const e = await motivoDe(subir());
      expect(e).toContain('no hay archivos sueltos');
      expect(e).toContain('conserva el archivo');
      expect(subidas).toHaveLength(0);
    });
  });

  describe('lo que no acepta', () => {
    it('sin callId no hay a qué atarla', async () => {
      await expect(subir({ callId: '  ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('una grabación vacía no se guarda como si fuera una grabación', async () => {
      await expect(subir({ contenido: Buffer.alloc(0) })).rejects.toThrow(
        BadRequestException,
      );
      await expect(subir({ contenido: undefined })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('el tipo sale de la extensión, no del Content-Type que manda curl', async () => {
      await subir({
        nombre: 'asterisk-123.wav',
        tipoMime: 'application/octet-stream',
      });
      expect(subidas[0].datos['tipoMime']).toBe('audio/wav');
    });

    it('si la extensión no dice nada, acepta un audio/* declarado', async () => {
      await subir({
        nombre: 'grabacion',
        tipoMime: 'audio/x-raro; charset=binary',
      });
      expect(subidas[0].datos['tipoMime']).toBe('audio/x-raro');
    });

    it('y si ni la extensión ni el tipo son de audio, lo rechaza nombrando lo que acepta', async () => {
      const subida = subir({ nombre: 'notas.txt', tipoMime: 'text/plain' });
      await expect(subida).rejects.toThrow(BadRequestException);
      const e = await motivoDe(
        subir({ nombre: 'notas.txt', tipoMime: 'text/plain' }),
      );
      expect(e).toContain('mp3');
      expect(e).toContain('wav');
    });
  });
});
