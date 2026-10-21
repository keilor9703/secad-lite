import { Test } from '@nestjs/testing';

import { ArchivosService } from '../archivos/archivos.service';
import { CasosGateway } from '../casos/casos.gateway';
import { CatalogosService } from '../catalogos/catalogos.service';
import { CasosService } from '../casos/casos.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantsService } from '../tenants/tenants.service';
import { HORAS_VENTANA_WHATSAPP, WhatsappService } from './whatsapp.service';
/** Lo que se mandó al expediente del caso. */
const adjuntados: unknown[] = [];

/** Catálogo del municipio con el que se arma el menú de tipificación. */
const catalogoDePrueba = [
  { codigo: 'RIN', descripcion: 'Riña o agresión', prioridad: 'alta' },
  { codigo: 'INC', descripcion: 'Incendio', prioridad: 'alta' },
];


/**
 * MANDAR EL ENLACE DE LA VIDEOLLAMADA POR WHATSAPP.
 *
 * Si el ciudadano ya está escribiendo por WhatsApp, mandarle el enlace por
 * ahí gana al SMS en las tres cosas que importan: no cuesta, el enlace es
 * pulsable, y se sabe si llegó.
 *
 * Lo delicado no es el camino feliz: es saber CUÁNDO no se puede. WhatsApp
 * solo admite texto libre dentro de las 24 horas siguientes al último mensaje
 * del ciudadano, y un envío fuera de plazo no falla de forma visible — lo
 * rechaza el proveedor. Si esto dijera que sí cuando es que no, el despachador
 * se quedaría esperando a alguien que nunca va a recibir el enlace.
 */
describe('WhatsappService · ¿se puede escribir por WhatsApp?', () => {
  let svc: WhatsappService;
  /** El caso de WhatsApp que encuentra la consulta, si lo hay. */
  let caso: { id: string; telefono: string } | null;
  /** Cuándo escribió el ciudadano por última vez. Nulo = nunca. */
  let ultimoDelCiudadano: Date | null;
  /** Lo que se intentó mandar. */
  let enviados: { to: string; texto: string }[];
  /** El número por el que preguntó la consulta (para comprobar la cola). */
  let colaConsultada: string | null;

  const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000);

  beforeEach(async () => {
    caso = null;
    ultimoDelCiudadano = null;
    enviados = [];
    colaConsultada = null;

    const qb = {
      where: () => qb,
      andWhere: (_sql: string, params?: Record<string, string>) => {
        if (params?.['cola']) colaConsultada = params['cola'];
        return qb;
      },
      orderBy: () => qb,
      getOne: () => Promise.resolve(caso),
    };

    const modulo = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: CasosService, useValue: { crear: () => Promise.resolve({ id: 'x' }) } },
        {
          provide: ArchivosService,
          useValue: { subirCompleto: (_t: string, d: unknown) => { adjuntados.push(d); return Promise.resolve({}); } },
        },
        {
          provide: CatalogosService,
          useValue: { listarCodigos: () => Promise.resolve(catalogoDePrueba) },
        },
        { provide: CasosGateway, useValue: { emitirCambio: () => undefined } },
        {
          provide: TenantsService,
          useValue: {
            // Línea conectada a Infobip y lista para enviar.
            porCodigo: () => Promise.resolve({ codigo: 'itagui', waNumero: '573132354086' }),
            porWaNumero: () => Promise.resolve(null),
            waAccessTokenDe: () => Promise.resolve(null),
            asegurarVigente: () => undefined,
          },
        },
        {
          provide: TenantRlsService,
          useValue: {
            conTenant: (_t: string, fn: (m: unknown) => unknown) =>
              fn({
                getRepository: (e: { name?: string }) =>
                  e?.name === 'CasoEntity'
                    ? { createQueryBuilder: () => qb }
                    : {
                        findOne: () =>
                          Promise.resolve(
                            ultimoDelCiudadano ? { creadoEn: ultimoDelCiudadano } : null,
                          ),
                      },
              }),
          },
        },
      ],
    }).compile();

    svc = modulo.get(WhatsappService);

    // Infobip configurado, y se anota qué se manda en vez de salir a la red.
    process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
    process.env['INFOBIP_API_KEY'] = 'clave-de-prueba';
    globalThis.fetch = ((_url: string, init: { body: string }) => {
      const cuerpo = JSON.parse(init.body) as { to: string; content: { text: string } };
      enviados.push({ to: cuerpo.to, texto: cuerpo.content.text });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env['INFOBIP_BASE_URL'];
    delete process.env['INFOBIP_API_KEY'];
  });

  const enviar = (telefono: string) =>
    svc.enviarSiHayConversacion('itagui', telefono, 'Abra este enlace: https://x/v/abc');

  describe('cuándo SÍ', () => {
    it('con conversación abierta y el ciudadano escribiendo hace poco', async () => {
      caso = { id: 'caso-1', telefono: '573175882321' };
      ultimoDelCiudadano = hace(2);

      expect(await enviar('573175882321')).toBe(true);
      expect(enviados.length).toBe(1);
      expect(enviados[0].texto).toContain('https://x/v/abc');
    });

    it('el mismo número escrito de otra forma sigue siendo la misma persona', async () => {
      // `573175882321` desde el webhook, `+57 317 588 2321` tecleado por el
      // operador. Si se comparara la cadena entera serían dos personas y el
      // enlace se iría por SMS teniendo la conversación abierta delante.
      caso = { id: 'caso-1', telefono: '573175882321' };
      ultimoDelCiudadano = hace(1);

      expect(await enviar('+57 317 588 2321')).toBe(true);
      expect(colaConsultada).toBe('%3175882321');
    });
  });

  describe('cuándo NO, que es lo que de verdad importa', () => {
    it('fuera de la ventana de 24 horas NO se manda', async () => {
      // Un caso puede llevar tres días abierto con el último mensaje del
      // ciudadano hace dos. Mandar ahí se da por enviado y no llega nada.
      caso = { id: 'caso-1', telefono: '573175882321' };
      ultimoDelCiudadano = hace(HORAS_VENTANA_WHATSAPP + 1);

      expect(await enviar('573175882321')).toBe(false);
      expect(enviados).toEqual([]);
    });

    it('justo dentro del plazo sí, justo fuera no', async () => {
      // El límite tiene que estar donde se dice que está.
      caso = { id: 'caso-1', telefono: '573175882321' };

      ultimoDelCiudadano = hace(HORAS_VENTANA_WHATSAPP - 0.1);
      expect(await enviar('573175882321')).toBe(true);

      enviados = [];
      ultimoDelCiudadano = hace(HORAS_VENTANA_WHATSAPP + 0.1);
      expect(await enviar('573175882321')).toBe(false);
    });

    it('sin caso de WhatsApp abierto NO se manda', async () => {
      // La emergencia entró por teléfono: no hay ninguna conversación.
      caso = null;
      ultimoDelCiudadano = hace(1);

      expect(await enviar('573175882321')).toBe(false);
      expect(enviados).toEqual([]);
    });

    it('un caso donde solo ha hablado el operador NO abre la ventana', async () => {
      // La ventana la abre el CIUDADANO. Que el operador haya escrito hace un
      // minuto no da permiso para nada.
      caso = { id: 'caso-1', telefono: '573175882321' };
      ultimoDelCiudadano = null;

      expect(await enviar('573175882321')).toBe(false);
    });

    it('sin número no se intenta nada', async () => {
      expect(await enviar('')).toBe(false);
      expect(enviados).toEqual([]);
    });

    it('si la consulta revienta, se dice que no y no se lanza', async () => {
      // Quien llama tiene el SMS como camino alterno. Un fallo aquí no puede
      // dejar al ciudadano sin enlace por ningún lado.
      caso = { id: 'caso-1', telefono: '573175882321' };
      ultimoDelCiudadano = hace(1);
      const rls = (svc as unknown as { rls: { conTenant: unknown } }).rls;
      rls.conTenant = () => Promise.reject(new Error('base caída'));

      await expect(enviar('573175882321')).resolves.toBe(false);
    });
  });
});
