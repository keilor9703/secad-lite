import { Test } from '@nestjs/testing';

import { ArchivosService } from '../archivos/archivos.service';
import { CasosGateway } from '../casos/casos.gateway';
import { CasosService } from '../casos/casos.service';
import { CatalogosService } from '../catalogos/catalogos.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappService, rutaDeEnlace } from './whatsapp.service';

/**
 * LA PLANTILLA APROBADA: ESCRIBIRLE PRIMERO AL CIUDADANO.
 *
 * WhatsApp no deja escribirle a nadie que no haya escrito antes. Dentro de la
 * ventana de 24 horas vale texto libre; fuera de ella, lo único que Meta
 * entrega es una plantilla que revisó y aprobó de antemano.
 *
 * La plantilla aprobada el 22/10/2026 (`videollamadafalconcad`, es_CO) lleva
 * el dominio ESCRITO DENTRO y su botón recibe solo lo que va después.
 */
describe('rutaDeEnlace', () => {
  it('del enlace completo saca solo la ruta', () => {
    // Mandar la URL entera produciría
    // `https://falconcad.com.co/https://falconcad.com.co/v/...`: un enlace
    // muerto que el operador daría por enviado, y el ciudadano esperando una
    // videollamada que nunca va a poder abrir.
    expect(rutaDeEnlace('https://falconcad.com.co/v/demo-k7m2x9qr4t8v'))
      .toBe('/v/demo-k7m2x9qr4t8v');
  });

  it('sirve con cualquier dominio, no solo el de producción', () => {
    // Un municipio en su propio dominio tiene que funcionar igual.
    expect(rutaDeEnlace('https://itagui.gov.co/v/itagui-abc123'))
      .toBe('/v/itagui-abc123');
  });

  it('conserva lo que venga después del signo de interrogación', () => {
    expect(rutaDeEnlace('https://x.co/v/abc?t=1')).toBe('/v/abc?t=1');
  });

  describe('lo que NO se manda', () => {
    it('una URL sin ruta: el botón llevaría a la portada', () => {
      // Y el ciudadano se quedaría mirando la página de inicio sin saber qué
      // hacer, en mitad de una emergencia.
      expect(rutaDeEnlace('https://falconcad.com.co')).toBeNull();
      expect(rutaDeEnlace('https://falconcad.com.co/')).toBeNull();
    });

    it('algo que no es una URL', () => {
      expect(rutaDeEnlace('')).toBeNull();
      expect(rutaDeEnlace('v/abc')).toBeNull();
      expect(rutaDeEnlace('no es una url')).toBeNull();
    });
  });
});

/**
 * A QUIÉN SE LE MANDA LA PLANTILLA, Y A QUIÉN NO.
 *
 * Infobip acepta una plantilla dirigida a un teléfono fijo y responde 200. El
 * rechazo llega más tarde, en un informe de entrega que no escuchamos. Así que
 * sin el freno de `pareceMovil`, el operador leía «Enviado por WhatsApp», el
 * ciudadano no recibía nada, y el SMS —el camino que sí le habría llegado— no
 * se intentaba nunca, porque `crear()` solo cae al SMS cuando WhatsApp dice
 * que no.
 *
 * Por eso lo que se afirma aquí no es el texto del mensaje: es que NO SE SALE
 * A LA RED. Un 200 del proveedor no distingue los dos casos.
 */
describe('WhatsappService · enviarPlantillaVideollamada', () => {
  let svc: WhatsappService;
  /** Peticiones que llegaron a salir. Vacío = no se intentó nada. */
  let salidas: { to: string; templateName: string; boton: string }[];

  beforeEach(async () => {
    salidas = [];

    const modulo = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: CasosService, useValue: {} },
        { provide: ArchivosService, useValue: {} },
        { provide: CatalogosService, useValue: {} },
        { provide: CasosGateway, useValue: { emitirCambio: () => undefined } },
        {
          provide: TenantsService,
          useValue: {
            porCodigo: () => Promise.resolve({ codigo: 'itagui', waNumero: '573132354086' }),
            asegurarVigente: () => undefined,
          },
        },
        { provide: TenantRlsService, useValue: { conTenant: () => Promise.resolve(null) } },
      ],
    }).compile();

    svc = modulo.get(WhatsappService);

    process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
    process.env['INFOBIP_API_KEY'] = 'clave-de-prueba';
    process.env['WA_PLANTILLA_VIDEOLLAMADA'] = 'videollamadafalconcad';
    process.env['WA_PLANTILLA_IDIOMA'] = 'es_CO';

    globalThis.fetch = ((_url: string, init: { body: string }) => {
      const cuerpo = JSON.parse(init.body) as {
        messages: {
          to: string;
          content: {
            templateName: string;
            templateData: { buttons: { parameter: string }[] };
          };
        }[];
      };
      const m = cuerpo.messages[0];
      salidas.push({
        to: m.to,
        templateName: m.content.templateName,
        boton: m.content.templateData.buttons[0].parameter,
      });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env['INFOBIP_BASE_URL'];
    delete process.env['INFOBIP_API_KEY'];
    delete process.env['WA_PLANTILLA_VIDEOLLAMADA'];
    delete process.env['WA_PLANTILLA_IDIOMA'];
  });

  const enviar = (to: string) =>
    svc.enviarPlantillaVideollamada('itagui', to, 'DEMO-2026-0001',
      'https://falconcad.com.co/v/demo-k7m2x9qr4t8v');

  it('a un móvil sale, con el caso en el cuerpo y solo la ruta en el botón', async () => {
    const r = await enviar('+57 317 588 2321');

    expect(r.ok).toBe(true);
    expect(salidas.length).toBe(1);
    expect(salidas[0].to).toBe('573175882321');
    expect(salidas[0].templateName).toBe('videollamadafalconcad');
    expect(salidas[0].boton).toBe('/v/demo-k7m2x9qr4t8v');
  });

  it('a un fijo NI SE INTENTA, para que quien llama caiga al SMS', async () => {
    // Si saliera, Infobip diría 200 y `crear()` daría el enlace por entregado.
    const r = await enviar('576042161000');

    expect(r.ok).toBe(false);
    expect(salidas).toEqual([]);
    expect(r.detalle).toContain('no parece un móvil');
  });

  it('sin plantilla configurada tampoco se intenta', async () => {
    // Durante días el servidor tuvo la variable sin declarar en el compose.
    delete process.env['WA_PLANTILLA_VIDEOLLAMADA'];

    const r = await enviar('573175882321');

    expect(r.ok).toBe(false);
    expect(salidas).toEqual([]);
  });

  it('con un enlace sin ruta tampoco, que el botón llevaría a la portada', async () => {
    const r = await svc.enviarPlantillaVideollamada(
      'itagui', '573175882321', 'DEMO-2026-0001', 'https://falconcad.com.co');

    expect(r.ok).toBe(false);
    expect(salidas).toEqual([]);
  });

  it('si Infobip responde mal, se dice que no para que el SMS tome el relevo', async () => {
    globalThis.fetch = (() =>
      Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('{"requestError":{}}') })
    ) as unknown as typeof fetch;

    const r = await enviar('573175882321');

    expect(r.ok).toBe(false);
  });

  it('si la red se cae, se dice que no y no se lanza', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('sin red'))) as unknown as typeof fetch;

    await expect(enviar('573175882321')).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
  });
});
