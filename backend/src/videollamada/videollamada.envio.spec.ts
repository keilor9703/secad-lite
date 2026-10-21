import { ConfigService } from '@nestjs/config';
import { VideollamadaService } from './videollamada.service';
import { VideoSesionEntity } from './video-sesion.entity';
import { CasoEntity } from '../casos/caso.entity';

/**
 * EL ORDEN CONFIGURADO SE RESPETA DE VERDAD.
 *
 * Las pruebas de `orden-envio.spec.ts` comprueban la pieza que decide. Esta
 * comprueba el CABLE: que `crear()` lea el orden de la instancia en vez de
 * llevar uno escrito dentro. Sin esto, la pantalla de Administración podría
 * guardar el orden que quisiera y el enlace seguiría saliendo por donde
 * siempre — una configuración que miente es peor que no tenerla.
 */
describe('VideollamadaService · por dónde sale el enlace', () => {
  let svc: VideollamadaService;
  /** Lo que devuelve la instancia como orden configurado. */
  let orden: string[];
  /** Qué caminos se intentaron, en qué orden. */
  let intentados: string[];
  /** Qué camino acepta el envío. */
  let elQueFunciona: 'whatsapp' | 'plantilla' | 'sms' | null;

  const caso = { id: 'caso-1', tenant: 'itagui', titulo: 'Riña', codigoCaso: 'ITA-2026-0007' };

  beforeEach(() => {
    orden = ['whatsapp', 'plantilla', 'sms'];
    intentados = [];
    elQueFunciona = null;

    // RLS: devuelve el caso, y guarda/lee sesiones en memoria.
    const guardadas: VideoSesionEntity[] = [];
    const rls = {
      conTenant: (_t: string, fn: (m: unknown) => unknown) =>
        Promise.resolve(fn({
          getRepository: (e: { name?: string }) => {
            if (e === CasoEntity || e?.name === 'CasoEntity') {
              return { findOne: () => Promise.resolve(caso) };
            }
            return {
              create: (d: Partial<VideoSesionEntity>) => d as VideoSesionEntity,
              save: (d: VideoSesionEntity) => {
                const s = { ...d, id: 'sesion-1' } as VideoSesionEntity;
                guardadas.push(s);
                return Promise.resolve(s);
              },
              // No hay ninguna videollamada en curso: siempre se crea una nueva.
              findOne: () => Promise.resolve(null),
              update: () => Promise.resolve({}),
            };
          },
        })),
    };

    const whatsapp = {
      enviarSiHayConversacion: () => {
        intentados.push('whatsapp');
        return Promise.resolve(elQueFunciona === 'whatsapp');
      },
      enviarPlantillaVideollamada: () => {
        intentados.push('plantilla');
        return Promise.resolve({ ok: elQueFunciona === 'plantilla', detalle: '' });
      },
    };
    const sms = {
      enviar: () => {
        intentados.push('sms');
        return Promise.resolve(elQueFunciona === 'sms');
      },
    };

    svc = new VideollamadaService(
      rls as never,
      { minutosPorDefecto: 30, crear: () => 'token-de-prueba' } as never,
      sms as never,
      whatsapp as never,
      { ordenDelEnlace: () => Promise.resolve([...orden]) } as never,
      new ConfigService({ FRONTEND_URL: 'https://falconcad.com.co' }),
    );
  });

  const crear = () => svc.crear('itagui', 'caso-1', '573175882321', 'operador1');

  it('sin configurar nada, el orden automático', async () => {
    elQueFunciona = 'sms';

    const r = await crear();

    expect(intentados).toEqual(['whatsapp', 'plantilla', 'sms']);
    expect(r.enviadoPor).toBe('sms');
  });

  it('con el SMS primero, el SMS sale primero', async () => {
    // Es el caso del municipio con SMS incluido en su plan: prefiere la
    // fiabilidad del mensaje de texto a que el enlace sea pulsable.
    orden = ['sms', 'whatsapp', 'plantilla'];
    elQueFunciona = 'whatsapp';

    const r = await crear();

    // El SMS se intentó ANTES. Si esto dijera `['whatsapp']`, el cable no
    // existe y la pantalla de Administración no sirve para nada.
    expect(intentados).toEqual(['sms', 'whatsapp']);
    expect(r.enviadoPor).toBe('whatsapp');
  });

  it('con la plantilla primero, la plantilla sale primero', async () => {
    orden = ['plantilla', 'whatsapp', 'sms'];
    elQueFunciona = 'plantilla';

    const r = await crear();

    expect(intentados).toEqual(['plantilla']);
    expect(r.enviadoPor).toBe('whatsapp-plantilla');
    // Y se le dice al despachador que el ciudadano recibe un BOTÓN.
    expect(r.mensaje).toContain('pulse el botón');
  });

  it('un camino excluido no se intenta: no se paga un SMS por accidente', async () => {
    orden = ['whatsapp', 'plantilla'];
    elQueFunciona = 'sms';

    const r = await crear();

    expect(intentados).toEqual(['whatsapp', 'plantilla']);
    expect(r.enviadoPor).toBeNull();
    // La videollamada queda abierta igual y el despachador puede dictar el
    // enlace: no enviarlo no es no atender.
    expect(r.enlace).toContain('/v/');
    expect(r.mensaje).toContain('díctelo');
  });

  it('sin teléfono no se intenta ningún camino', async () => {
    const r = await svc.crear('itagui', 'caso-1', '', 'operador1');

    expect(intentados).toEqual([]);
    expect(r.enviadoPor).toBeNull();
  });
});
