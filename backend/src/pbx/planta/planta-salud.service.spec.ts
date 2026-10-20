import { Repository } from 'typeorm';

import { PlantaAsteriskEntity } from './planta-asterisk.entity';
import { PlantaSaludEntity, hayQueAvisar } from './planta-salud.entity';
import { PlantaSaludService } from './planta-salud.service';
import { PbxCredencialesService } from '../pbx-credenciales.service';
import { CorreoService, MensajeCorreo } from '../../correo/correo.service';

/**
 * LA VIGILANCIA DE LAS PLANTAS.
 *
 * Lo que se protege aquí no es «que el chequeo corra»: es que el chequeo
 * **sirva para operar de madrugada**. Cada prueba corresponde a una forma
 * concreta en que un monitoreo deja de servir:
 *
 *  1. **Que no distinga «arriba» de «atendiendo».** La noche del 19 de octubre
 *     la planta estaba arriba —contenedor corriendo, puerto escuchando— y no
 *     servía para nada. Un chequeo que solo mira si el proceso vive habría
 *     dicho que todo estaba bien.
 *  2. **Que avise cada cinco minutos.** Un correo repetido deja de leerse al
 *     tercero, y entonces el monitoreo empeora las cosas en vez de mejorarlas.
 *  3. **Que pierda «desde cuándo».** Sin eso, una caída de dos minutos y una
 *     de dos días se ven igual, y no se puede decidir si hay que levantarse.
 *  4. **Que haga ruido con plantas que no están atendiendo todavía.** Un
 *     borrador no existe en ningún servidor; avisar de él es ruido, y el ruido
 *     es lo que hace que un monitoreo se deje de mirar.
 *  5. **Que un fallo propio se vea como una planta caída.**
 */
describe('PlantaSaludService', () => {
  let svc: PlantaSaludService;
  let plantas: PlantaAsteriskEntity[];
  let filas: PlantaSaludEntity[];
  let correos: MensajeCorreo[];
  /** Lo que contesta el ARI falso, por ruta. */
  let ari: Record<string, { estado: number; cuerpo?: unknown }>;
  /** Lo que contesta el certificado falso. */
  let vence: Date | null;

  const planta = (cambios: Partial<PlantaAsteriskEntity> = {}) =>
    ({
      tenant: 'itagui',
      servidor: '129.80.243.118',
      dominioSip: 'itagui-pbx.falconcad.com.co',
      estado: 'activa',
      ...cambios,
    }) as PlantaAsteriskEntity;

  beforeEach(() => {
    plantas = [planta()];
    filas = [];
    correos = [];
    vence = new Date(Date.now() + 90 * 86_400_000);
    ari = {
      'asterisk/info': {
        estado: 200,
        cuerpo: { system: { version: '20.6.0' } },
      },
      endpoints: {
        estado: 200,
        cuerpo: [
          { resource: 'troncal', state: 'online' },
          { resource: '101', state: 'online' },
          { resource: '102', state: 'offline' },
        ],
      },
    };

    global.fetch = (async (url: string) => {
      const ruta = String(url).split('/ari/')[1];
      const r = ari[ruta];
      if (!r) throw new Error(`ruta no simulada: ${ruta}`);
      return {
        ok: r.estado >= 200 && r.estado < 300,
        status: r.estado,
        json: async () => r.cuerpo,
      };
    }) as unknown as typeof fetch;

    const repoPlantas = {
      find: async ({ where }: { where: { estado: string } }) =>
        plantas.filter((p) => p.estado === where.estado),
    } as unknown as Repository<PlantaAsteriskEntity>;

    const repoSalud = {
      findOne: async ({ where }: { where: { tenant: string } }) =>
        filas.find((f) => f.tenant === where.tenant) ?? null,
      create: (x: Partial<PlantaSaludEntity>) =>
        ({ ...x }) as PlantaSaludEntity,
      save: async (f: PlantaSaludEntity) => {
        const i = filas.findIndex((x) => x.tenant === f.tenant);
        if (i >= 0) filas[i] = f;
        else filas.push(f);
        return f;
      },
    } as unknown as Repository<PlantaSaludEntity>;

    const cred = {
      configDe: async () => null,
      enClaro: () => ({ ariClave: 'la-clave-de-ari' }),
    } as unknown as PbxCredencialesService;

    const correo = {
      enviar: async (m: MensajeCorreo) => {
        correos.push(m);
        return { ok: true };
      },
    } as unknown as CorreoService;

    svc = new PlantaSaludService(repoPlantas, repoSalud, cred, correo);
    // El apretón de manos TLS no se puede hacer en una prueba: se sustituye la
    // medición, no la decisión de qué hacer con ella.
    (svc as unknown as { certificado: () => Promise<unknown> }).certificado =
      async () => (vence ? { vence } : { vence: null, error: 'sin respuesta' });
  });

  describe('qué mide', () => {
    it('una planta sana sale bien, con su versión y sus operadores', async () => {
      const r = await svc.revisarYGuardar(planta());
      expect(r.bien).toBe(true);
      expect(r.fallas).toEqual([]);
      expect(r.version).toBe('20.6.0');
      // Solo los conectados, y la troncal no cuenta como operador.
      expect(r.operadores).toBe(1);
    });

    it('Asterisk que no contesta es una falla', async () => {
      ari['asterisk/info'] = { estado: 500 };
      const r = await svc.revisarYGuardar(planta());
      expect(r.bien).toBe(false);
      expect(r.fallas).toContain('asterisk');
    });

    it('distingue «arriba» de «atendiendo»: la troncal caída es una falla', async () => {
      // ESTO ES LO QUE PASÓ. Asterisk responde, el contenedor vive, el puerto
      // escucha — y no entra una sola llamada. Un chequeo que solo mira si el
      // proceso está vivo habría dicho que todo estaba bien.
      ari['endpoints'] = {
        estado: 200,
        cuerpo: [{ resource: 'troncal', state: 'offline' }],
      };
      const r = await svc.revisarYGuardar(planta());
      expect(r.bien).toBe(false);
      expect(r.fallas).toContain('troncal');
      expect(r.fallas).not.toContain('asterisk');
    });

    it('una planta sin troncal configurada tampoco está atendiendo', async () => {
      ari['endpoints'] = {
        estado: 200,
        cuerpo: [{ resource: '101', state: 'online' }],
      };
      const r = await svc.revisarYGuardar(planta());
      expect(r.fallas).toContain('troncal');
    });

    it('el certificado por vencer avisa ANTES de que deje de funcionar', async () => {
      // Avisar el día que vence es inútil: ese día el softphone ya no conecta
      // en ningún puesto y nadie sabe por qué.
      vence = new Date(Date.now() + 10 * 86_400_000);
      const r = await svc.revisarYGuardar(planta());
      expect(r.fallas).toContain('certificado');
      // Días exactos NO: el cálculo redondea hacia abajo y unos milisegundos
      // entre preparar la fecha y medirla convierten 10 en 9. La garantía es
      // que avisa ANTES de vencer —queda tiempo, y se dice cuánto—, no el
      // número. Esta prueba ya falló una vez por eso.
      expect(r.detalle).toMatch(/vence en \d+ día/);
      expect(r.detalle).not.toContain('venció');
    });

    it('el certificado vencido se distingue del que está por vencer', async () => {
      vence = new Date(Date.now() - 3 * 86_400_000);
      const r = await svc.revisarYGuardar(planta());
      expect(r.fallas).toContain('certificado-vencido');
      expect(r.fallas).not.toContain('certificado');
    });

    it('un certificado lejano no es falla', async () => {
      vence = new Date(Date.now() + 80 * 86_400_000);
      const r = await svc.revisarYGuardar(planta());
      expect(r.fallas).not.toContain('certificado');
      expect(r.fallas).not.toContain('certificado-vencido');
    });

    it('sin clave de ARI no inventa que la planta está bien', async () => {
      const cred = {
        configDe: async () => null,
        enClaro: () => ({ ariClave: '' }),
      } as unknown as PbxCredencialesService;
      (svc as unknown as { cred: PbxCredencialesService }).cred = cred;
      const r = await svc.revisarYGuardar(planta());
      expect(r.bien).toBe(false);
      expect(r.detalle).toContain('no se ha aplicado');
    });
  });

  describe('cuándo avisa', () => {
    it('avisa cuando aparece la falla', async () => {
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      expect(correos).toHaveLength(1);
      expect(correos[0].asunto).toContain('itagui');
    });

    it('NO avisa otra vez mientras la misma falla sigue ahí', async () => {
      // Un correo cada cinco minutos deja de leerse al tercero, y entonces el
      // monitoreo empeora las cosas en vez de mejorarlas.
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      await svc.revisarYGuardar(planta());
      await svc.revisarYGuardar(planta());
      expect(correos).toHaveLength(1);
    });

    it('sí avisa cuando aparece una falla NUEVA sobre una conocida', async () => {
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      vence = new Date(Date.now() - 1 * 86_400_000);
      await svc.revisarYGuardar(planta());
      expect(correos).toHaveLength(2);
    });

    it('vuelve a avisar si se arregla y se rompe otra vez', async () => {
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      ari['asterisk/info'] = {
        estado: 200,
        cuerpo: { system: { version: '20' } },
      };
      await svc.revisarYGuardar(planta());
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      expect(correos).toHaveLength(2);
    });

    it('una planta sana no manda nada', async () => {
      await svc.revisarYGuardar(planta());
      expect(correos).toHaveLength(0);
    });

    it('el aviso dice qué deja de poder hacer el ciudadano', async () => {
      // Quien lo recibe a las tres de la mañana necesita saber si tiene que
      // levantarse, no qué comprobación falló.
      ari['endpoints'] = {
        estado: 200,
        cuerpo: [{ resource: 'troncal', state: 'offline' }],
      };
      await svc.revisarYGuardar(planta());
      expect(correos[0].texto).toContain('no llegan');
    });
  });

  describe('desde cuándo falla', () => {
    it('lo fija en la primera revisión mala y no lo toca después', async () => {
      // Sin esto, una caída de dos minutos y una de dos días se ven igual.
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      const primero = filas[0].fallaDesde;
      expect(primero).toBeTruthy();

      await new Promise((r) => setTimeout(r, 5));
      await svc.revisarYGuardar(planta());
      expect(filas[0].fallaDesde).toEqual(primero);
    });

    it('lo borra en cuanto una revisión sale bien', async () => {
      ari['asterisk/info'] = { estado: 500 };
      await svc.revisarYGuardar(planta());
      ari['asterisk/info'] = {
        estado: 200,
        cuerpo: { system: { version: '20' } },
      };
      await svc.revisarYGuardar(planta());
      expect(filas[0].fallaDesde).toBeNull();
      expect(filas[0].bien).toBe(true);
    });
  });

  describe('a cuáles mira', () => {
    it('solo a las activas: un borrador no existe en ningún servidor', async () => {
      plantas = [
        planta({ tenant: 'activa1', estado: 'activa' }),
        planta({ tenant: 'borrador1', estado: 'borrador' }),
        planta({ tenant: 'suspendida1', estado: 'suspendida' }),
      ];
      const n = await svc.revisarTodas();
      expect(n).toBe(1);
      expect(filas.map((f) => f.tenant)).toEqual(['activa1']);
    });

    it('una planta que explota no impide revisar las demás', async () => {
      plantas = [
        planta({ tenant: 'rota', estado: 'activa' }),
        planta({ tenant: 'sana', estado: 'activa' }),
      ];
      const original = global.fetch;
      global.fetch = (async (url: string) => {
        if (String(url).includes('rota')) throw new Error('boom');
        return (original as unknown as (u: string) => Promise<unknown>)(url);
      }) as unknown as typeof fetch;

      // «rota» no explota el barrido: su fetch falla y queda como caída.
      await expect(svc.revisarTodas()).resolves.toBe(2);
      expect(filas.map((f) => f.tenant).sort()).toEqual(['rota', 'sana']);
    });

    it('que no salga el correo no pierde la revisión', async () => {
      // El aviso es una cortesía del monitoreo; el registro es el monitoreo.
      (svc as unknown as { correo: CorreoService }).correo = {
        enviar: async () => {
          throw new Error('sin red');
        },
      } as unknown as CorreoService;
      ari['asterisk/info'] = { estado: 500 };
      await expect(svc.revisarYGuardar(planta())).resolves.toBeTruthy();
      expect(filas[0].bien).toBe(false);
    });
  });

  describe('hayQueAvisar', () => {
    it('avisa de lo nuevo y calla de lo conocido', () => {
      expect(hayQueAvisar(['troncal'], [])).toBe(true);
      expect(hayQueAvisar(['troncal'], ['troncal'])).toBe(false);
      expect(hayQueAvisar(['troncal', 'certificado'], ['troncal'])).toBe(true);
      // Que desaparezca una falla y quede otra no es noticia: ya se avisó.
      expect(hayQueAvisar(['troncal'], ['troncal', 'certificado'])).toBe(false);
    });
  });
});
