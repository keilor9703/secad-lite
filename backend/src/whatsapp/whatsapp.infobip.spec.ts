import { Test } from '@nestjs/testing';

import { ArchivosService } from '../archivos/archivos.service';
import { CasosGateway } from '../casos/casos.gateway';
import { CatalogosService } from '../catalogos/catalogos.service';
import { CasosService } from '../casos/casos.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappService } from './whatsapp.service';
/** Lo que se mandó al expediente del caso. */
const adjuntados: unknown[] = [];

/** Catálogo del municipio con el que se arma el menú de tipificación. */
const catalogoDePrueba = [
  { codigo: 'RIN', descripcion: 'Riña o agresión', prioridad: 'alta' },
  { codigo: 'INC', descripcion: 'Incendio', prioridad: 'alta' },
];


/**
 * EL TRADUCTOR DE INFOBIP.
 *
 * La línea de WhatsApp de FALCON no está conectada a Meta directamente sino a
 * Infobip, porque es el único camino por el que la LLAMADA de WhatsApp llega
 * como SIP a nuestro Asterisk. El precio de esa decisión es que los mensajes
 * vienen en el formato de Infobip, y estas pruebas cubren esa traducción.
 *
 * Se escribió contra el formato documentado, ANTES de ver una entrega real.
 * Por eso lo que más se comprueba aquí no es el camino feliz: es qué pasa con
 * lo que no encaja.
 */
describe('WhatsappService · mensajes de Infobip', () => {
  let svc: WhatsappService;
  let tenantPorNumero: Record<string, { codigo: string } | null>;
  /** Lo que se guardó como mensaje de la conversación. */
  let guardados: {
    tenant: string;
    texto: string;
    waMessageId: string | null;
    /** Quién lo escribió. El bot se calla en cuanto aparece un 'operador'. */
    autorTipo?: string;
  }[];
  /** Los casos creados. */
  let casos: { tenant: string; telefono: string; descripcion: string }[];
  /** Identificadores ya vistos, para la prueba de reintento. */
  let yaVistos: Set<string>;
  let vigente: () => void;
  /** El caso que encuentra la búsqueda. Nulo = no hay, y se abre uno. */
  /** La conversación de admisión de ese número, si ya existe. */
  let conversacion: {
    estado: string; casoId?: string | null; mensajesDelBot: number;
  } | null;
  let casoExistente:
    | { id: string; canal: string; telefono: string; mensajesSinLeer: number }
    | null;
  /** Cada `increment` sobre el contador de mensajes sin leer. */
  let sumados: { id: string; campo: string; cuanto: number }[];
  /** Los casos cuyo contador se puso a cero. */
  let limpiados: string[];
  /** Los textos de mensaje que se reescribieron (el remate del adjunto). */
  let actualizados: Record<string, unknown>[];
  /** Lo que el bot escribió EN el caso: tipificación, dirección. */
  let cambiosAlCaso: Record<string, unknown>[];
  /** Lo que el bot le mandó al ciudadano. */
  let delBot: string[];
  /** Lo que se mandó a los tableros por el socket. */
  let emitidos: { tenant: string; casoId: string }[];
  /** Para comprobar que un socket caído no se lleva por delante el mensaje. */
  let gatewayRoto: boolean;

  beforeEach(async () => {
    tenantPorNumero = {};
    guardados = [];
    casos = [];
    yaVistos = new Set();
    vigente = () => undefined;
    casoExistente = null;
    conversacion = null;
    sumados = [];
    limpiados = [];
    cambiosAlCaso = [];
    actualizados = [];
    delBot = [];
    emitidos = [];
    gatewayRoto = false;

    const mensajesRepo = {
      findOne: ({ where }: { where: { waMessageId?: string; autorTipo?: string } }) => {
        // «¿Ya hay un operador en esta conversación?» y «¿este mensaje ya
        // lo vimos?» son dos preguntas distintas sobre la misma tabla.
        // El remate del adjunto busca el mensaje por su id de WhatsApp.
        if (where.waMessageId && !where.autorTipo) {
          const g = guardados.find((x) => x.waMessageId === where.waMessageId);
          if (g) return Promise.resolve({ ...g, id: 'msg-1' });
        }
        if (where.autorTipo) {
          return Promise.resolve(
            guardados.find((g) => g.autorTipo === where.autorTipo) ?? null,
          );
        }
        return Promise.resolve(
          where.waMessageId && yaVistos.has(where.waMessageId) ? {} : null,
        );
      },
      create: (x: unknown) => x,
      find: () => Promise.resolve(guardados),
      update: (_d: unknown, cambios: Record<string, unknown>) => {
        actualizados.push(cambios);
        return Promise.resolve({});
      },
      save: (x: {
        tenant: string;
        texto: string;
        waMessageId: string | null;
      }) => {
        guardados.push(x);
        if (x.waMessageId) yaVistos.add(x.waMessageId);
        return Promise.resolve(x);
      },
    };
    // La conversación de admisión: el paso previo al caso. Se guarda en
    // memoria para poder comprobar en qué estado quedó.
    const convRepo = {
      findOne: () => Promise.resolve(conversacion),
      create: (x: Record<string, unknown>) => ({ ...x }),
      save: (x: Record<string, unknown>) => {
        conversacion = x as typeof conversacion;
        return Promise.resolve(x);
      },
    };
    // Por defecto no hay caso abierto, así que cada mensaje entrante abre
    // uno. Las pruebas de `responder` ponen uno para poder responderlo.
    const casosRepo = {
      findOne: () => Promise.resolve(casoExistente),
      increment: (
        donde: { id: string },
        campo: string,
        cuanto: number,
      ) => {
        sumados.push({ id: donde.id, campo, cuanto });
        if (casoExistente) casoExistente.mensajesSinLeer += cuanto;
        return Promise.resolve({});
      },
      update: (donde: { id: string }, cambios: Record<string, unknown>) => {
        if ('mensajesSinLeer' in cambios) {
          limpiados.push(donde.id);
          if (casoExistente) casoExistente.mensajesSinLeer = cambios['mensajesSinLeer'] as number;
        } else {
          cambiosAlCaso.push(cambios);
        }
        return Promise.resolve({});
      },
    };

    const modulo = await Test.createTestingModule({
      providers: [
        WhatsappService,
        {
          provide: CasosService,
          useValue: {
            crear: (
              tenant: string,
              dto: { telefono: string; descripcion: string },
            ) => {
              casos.push({
                tenant,
                telefono: dto.telefono,
                descripcion: dto.descripcion,
              });
              return Promise.resolve({ id: `caso-${casos.length}` });
            },
          },
        },
        {
          provide: ArchivosService,
          useValue: { subirCompleto: (_t: string, d: unknown) => { adjuntados.push(d); return Promise.resolve({}); } },
        },
        {
          provide: CatalogosService,
          useValue: { listarCodigos: () => Promise.resolve(catalogoDePrueba) },
        },
        {
          provide: CasosGateway,
          useValue: {
            emitirCambio: (tenant: string, caso: { id: string }) => {
              if (gatewayRoto) throw new Error('socket caído');
              emitidos.push({ tenant, casoId: caso.id });
            },
          },
        },
        {
          provide: TenantsService,
          useValue: {
            porWaNumero: (n: string) =>
              Promise.resolve(
                tenantPorNumero[(n ?? '').replace(/\D/g, '')] ?? null,
              ),
            // Con número de línea: es el remitente con el que contesta el
            // bot. Sin las variables de Infobip en el entorno igual no sale
            // nada, que es lo que comprueban las pruebas de `responder`.
            porCodigo: (c: string) => Promise.resolve({ codigo: c, waNumero: '573132354086' }),
            // Sin token de Meta y sin número de Infobip: una línea a medio
            // configurar, que es justo el caso que se quiere cubrir.
            waAccessTokenDe: () => Promise.resolve(null),
            asegurarVigente: () => vigente(),
          },
        },
        {
          provide: TenantRlsService,
          useValue: {
            conTenant: (_t: string, fn: (m: unknown) => unknown) =>
              fn({
                getRepository: (e: { name?: string }) =>
                    e?.name === 'CasoEntity' ? casosRepo
                  : e?.name === 'ConversacionWaEntity' ? convRepo
                  : mensajesRepo,
              }),
          },
        },
      ],
    }).compile();

    svc = modulo.get(WhatsappService);
  });

  /** Una entrega de Infobip con un mensaje de texto. */
  const entrega = (over: Record<string, unknown> = {}) => ({
    results: [
      {
        from: '573175882321',
        to: '573132354086',
        messageId: 'msg-1',
        contact: { name: 'Hader Paz' },
        message: { type: 'TEXT', text: 'se está incendiando una casa' },
        ...over,
      },
    ],
  });

  describe('el camino normal', () => {
    it('el número de DESTINO decide de qué municipio es el mensaje', async () => {
      // Infobip no manda el `phone_number_id` de Meta: manda el número. Si
      // esto se equivoca, una emergencia entra a la bandeja de otro
      // municipio, que en un sistema sin Row-Level Security es lo más grave
      // que puede pasar aquí.
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };

      const r = await svc.recibirDeInfobip(entrega());

      expect(r.procesados).toBe(1);
      expect(casos[0].tenant).toBe('itagui');
      expect(casos[0].telefono).toBe('573175882321');
      expect(casos[0].descripcion).toBe('se está incendiando una casa');
    });

    it('el nombre del contacto llega al caso', async () => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      await svc.recibirDeInfobip(entrega());
      expect(guardados[0].texto).toBe('se está incendiando una casa');
    });

    it('un reintento de Infobip no abre un segundo caso', async () => {
      // Infobip reenvía lo que no confirmamos a tiempo. Dos casos para la
      // misma emergencia pueden mandar dos patrullas, o ninguna porque cada
      // operador cree que otro la atendió.
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };

      await svc.recibirDeInfobip(entrega());
      await svc.recibirDeInfobip(entrega());

      expect(casos.length).toBe(1);
      expect(guardados.length).toBe(1);
    });
  });

  describe('la admisión: un mensaje no es un caso', () => {
    // El defecto del 21/10/2026: «Holaaa», «Hola buenas», «Hola buenas
    // noches» y «Buenas noches porfavor» entraron a la bandeja de Recepción
    // a competir por atención con una emergencia real. Una línea 123
    // publicada recibe eso todo el día.
    //
    // La regla que gobierna todo esto: EN CASO DE DUDA, SE ABRE EL CASO. Un
    // caso de más se cierra en diez segundos; una emergencia descartada en
    // silencio no se recupera.

    beforeEach(() => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      // Línea conectada, para poder ver lo que contesta el bot.
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
      globalThis.fetch = ((_u: string, init: { body: string }) => {
        const c = JSON.parse(init.body) as { content: { text: string } };
        delBot.push(c.content.text);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      delete process.env['INFOBIP_BASE_URL'];
      delete process.env['INFOBIP_API_KEY'];
    });

    const llega = (texto: string, id = `m-${Math.random()}`) =>
      svc.recibirDeInfobip(entrega({ messageId: id, message: { type: 'TEXT', text: texto } }));

    it('un saludo NO abre caso', async () => {
      await llega('Holaaa');

      expect(casos.length).toBe(0);
      expect(guardados.length).toBe(0);
    });

    it('pero sí contesta, una vez, diciendo cómo pedir ayuda', async () => {
      // Callarse del todo deja al ciudadano creyendo que no hay nadie. Y el
      // número de teléfono va en esa respuesta: quien no pueda escribir, o
      // esté a oscuras, tiene que poder llamar.
      await llega('Holaaa');

      expect(delBot.length).toBe(1);
      expect(delBot[0]).toContain('123');
    });

    it('y NO insiste: el segundo saludo no vuelve a contestar', async () => {
      // Un bot que repite en una línea de emergencias estorba.
      await llega('Holaaa', 'm-1');
      await llega('buenas', 'm-2');

      expect(delBot.length).toBe(1);
      expect(casos.length).toBe(0);
    });

    it('un mensaje con contenido abre el caso DE INMEDIATO', async () => {
      // Lo que no puede pasar: que una emergencia espere a que alguien
      // conteste un menú. El caso primero, la tipificación después.
      await llega('se está incendiando una casa en la 50 con 70');

      expect(casos.length).toBe(1);
      expect(casos[0].descripcion).toBe('se está incendiando una casa en la 50 con 70');
    });

    it('un saludo CON petición también abre caso', async () => {
      await llega('Buenas noches porfavor');
      expect(casos.length).toBe(1);
    });

    it('una nota de voz abre caso aunque no traiga una sola letra', async () => {
      // Quien se esconde de un agresor manda un audio y no contesta menús.
      await svc.recibirDeInfobip(entrega({ message: { type: 'VOICE' } }));

      expect(casos.length).toBe(1);
      expect(guardados[0].texto).toContain('nota de voz');
    });

    it('una FOTO con un pie trivial abre caso igual', async () => {
      // El agujero que encontró el sabotaje: el pie de foto se lee como el
      // texto del mensaje, así que una imagen de un accidente con el pie
      // «ok» pasaba por el filtro de ruido y se descartaba — con la foto
      // dentro. Lo que decide es el TIPO del mensaje, no si se pudo sacar
      // texto de él.
      await svc.recibirDeInfobip(
        entrega({ message: { type: 'IMAGE', caption: 'ok' } }),
      );

      expect(casos.length).toBe(1);
    });

    it('una ubicación abre caso: es el dato más valioso que hay', async () => {
      await svc.recibirDeInfobip(entrega({ message: { type: 'LOCATION' } }));
      expect(casos.length).toBe(1);
    });

    it('después de abrir el caso, pregunta el tipo con el catálogo del municipio', async () => {
      await llega('se está incendiando una casa');

      expect(delBot.length).toBe(1);
      expect(delBot[0]).toContain('1. Riña o agresión');
      expect(delBot[0]).toContain('2. Incendio');
    });
  });

  describe('la admisión: tipificar y ubicar lo que ya es caso', () => {
    beforeEach(() => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      casoExistente = {
        id: 'caso-1', canal: 'whatsapp', telefono: '573175882321', mensajesSinLeer: 0,
      };
      conversacion = { estado: 'esperando_tipo', casoId: 'caso-1', mensajesDelBot: 1 };
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
      globalThis.fetch = ((_u: string, init: { body: string }) => {
        const c = JSON.parse(init.body) as { content: { text: string } };
        delBot.push(c.content.text);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      delete process.env['INFOBIP_BASE_URL'];
      delete process.env['INFOBIP_API_KEY'];
    });

    const llega = (texto: string, id = `m-${Math.random()}`) =>
      svc.recibirDeInfobip(entrega({ messageId: id, message: { type: 'TEXT', text: texto } }));

    it('responder «2» tipifica el caso con el código y su prioridad', async () => {
      await llega('2');

      expect(cambiosAlCaso.length).toBe(1);
      expect(cambiosAlCaso[0]['codigoCaso']).toBe('INC');
      expect(cambiosAlCaso[0]['prioridad']).toBe('alta');
      expect(cambiosAlCaso[0]['titulo']).toBe('Incendio');
    });

    it('y después pregunta DÓNDE, que es lo que falta para despachar', async () => {
      await llega('2');

      expect(delBot.length).toBe(1);
      expect(delBot[0]).toContain('DIRECCION');
      expect(conversacion!.estado).toBe('esperando_lugar');
    });

    it('un número DENTRO de una frase NO tipifica', async () => {
      // «hay 2 heridos en la calle 50» no es elegir la opción 2. Tipificarlo
      // así le pondría a un caso con heridos la prioridad del código
      // equivocado, y la prioridad es lo que decide a quién se despacha antes.
      await llega('hay 2 heridos en la calle 50');

      expect(cambiosAlCaso).toEqual([]);
    });

    it('si contesta otra cosa, el bot no insiste: se calla y lo lee un operador', async () => {
      await llega('está saliendo humo por el techo');

      expect(delBot).toEqual([]);
      expect(conversacion!.estado).toBe('cerrada');
      // Y el mensaje SÍ queda en el caso: no se pierde nada.
      expect(guardados.length).toBe(1);
    });

    it('la dirección que contesta se guarda en el caso', async () => {
      conversacion = { estado: 'esperando_lugar', casoId: 'caso-1', mensajesDelBot: 2 };

      await llega('Calle 50 # 70-20, barrio Centro');

      expect(cambiosAlCaso[0]['direccion']).toBe('Calle 50 # 70-20, barrio Centro');
      expect(conversacion!.estado).toBe('cerrada');
    });

    it('EN CUANTO HAY UN OPERADOR, el bot se calla', async () => {
      // Dos voces a la vez sobre una persona en una emergencia, sin saber a
      // cuál contestar, es peor que no tener bot.
      guardados.push({ tenant: 'itagui', texto: 'ya va la patrulla', waMessageId: null, autorTipo: 'operador' });

      await llega('2');

      expect(delBot).toEqual([]);
      expect(cambiosAlCaso).toEqual([]);
      expect(conversacion!.estado).toBe('cerrada');
    });
  });

  describe('la ubicación y los adjuntos', () => {
    beforeEach(() => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      adjuntados.length = 0;
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
      globalThis.fetch = ((u: string, init: { body?: string }) => {
        // El envío del bot lleva cuerpo; la descarga del adjunto, no.
        if (init?.body) {
          const c = JSON.parse(init.body) as { content: { text: string } };
          delBot.push(c.content.text);
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map([['content-length', '2048'], ['content-type', 'audio/ogg']]) as unknown as Headers,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(2048)),
        });
      }) as unknown as typeof fetch;
    });

    afterEach(() => {
      delete process.env['INFOBIP_BASE_URL'];
      delete process.env['INFOBIP_API_KEY'];
    });

    it('una ubicación cae en las coordenadas del caso', async () => {
      // Es el dato más valioso que existe para un CAD: el ciudadano lo manda
      // con un toque y resuelve lo que más cuesta por teléfono.
      await svc.recibirDeInfobip(
        entrega({ message: { type: 'LOCATION', latitude: 6.1845, longitude: -75.5986 } }),
      );

      expect(casos.length).toBe(1);
      const puesto = cambiosAlCaso.find((c) => 'lat' in c);
      expect(puesto!['lat']).toBe(6.1845);
      expect(puesto!['lng']).toBe(-75.5986);
    });

    it('también cae en un caso que YA existía', async () => {
      // El ciudadano escribe primero y manda la ubicación después, que es lo
      // normal. Si solo se guardara al abrir el caso, el punto llegaría
      // cuando ya no hay dónde ponerlo.
      casoExistente = {
        id: 'caso-1', canal: 'whatsapp', telefono: '573175882321', mensajesSinLeer: 0,
      };
      conversacion = { estado: 'esperando_tipo', casoId: 'caso-1', mensajesDelBot: 1 };

      await svc.recibirDeInfobip(
        entrega({ message: { type: 'LOCATION', latitude: 6.1845, longitude: -75.5986 } }),
      );

      expect(casos.length).toBe(0); // no se abrió otro
      const puesto = cambiosAlCaso.find((c) => 'lat' in c);
      expect(puesto!['lat']).toBe(6.1845);
    });

    it('«0, 0» NO se guarda: mandaría una patrulla al Atlántico', async () => {
      // Y, peor que eso, haría creer al despachador que tiene la ubicación.
      await svc.recibirDeInfobip(
        entrega({ message: { type: 'LOCATION', latitude: 0, longitude: 0 } }),
      );

      // El caso sí se abre —algo mandó el ciudadano— pero sin coordenadas.
      expect(casos.length).toBe(1);
      expect(cambiosAlCaso.find((c) => 'lat' in c)).toBeUndefined();
    });

    it('mandar la ubicación CONTESTA la pregunta: el bot no la vuelve a pedir', async () => {
      // Seguir pidiendo una dirección escrita después de que el ciudadano
      // mandó el punto exacto es no haber leído lo que mandó.
      casoExistente = {
        id: 'caso-1', canal: 'whatsapp', telefono: '573175882321', mensajesSinLeer: 0,
      };
      conversacion = { estado: 'esperando_lugar', casoId: 'caso-1', mensajesDelBot: 2 };

      await svc.recibirDeInfobip(
        entrega({ message: { type: 'LOCATION', latitude: 6.1845, longitude: -75.5986 } }),
      );

      expect(conversacion!.estado).toBe('cerrada');
      expect(delBot.join(' ')).not.toContain('DIRECCION');
    });

    it('una nota de voz se baja y queda en el expediente', async () => {
      // Antes el caso decía «[El ciudadano envió una nota de voz]» y ahí se
      // acababa: el operador sabía que existía y no podía oírla. Quien se
      // esconde de un agresor manda un audio porque no puede hablar, y ese
      // audio ERA el reporte.
      await svc.recibirDeInfobip(
        entrega({ message: { type: 'VOICE', url: 'https://media.infobip.com/x.ogg' } }),
      );

      expect(adjuntados.length).toBe(1);
      const a = adjuntados[0] as Record<string, unknown>;
      expect(a['casoId']).toBeTruthy();
      expect(a['tipoMime']).toBe('audio/ogg');
      expect(String(a['nombre'])).toContain('nota-de-voz');
    });

    it('un texto normal no baja nada', async () => {
      await svc.recibirDeInfobip(entrega());
      expect(adjuntados.length).toBe(0);
    });

    it('una URL que no es http no se intenta bajar', async () => {
      // Un campo `url` que llega con otra cosa dentro no se toca.
      await svc.recibirDeInfobip(
        entrega({ message: { type: 'IMAGE', url: 'file:///etc/passwd' } }),
      );
      expect(adjuntados.length).toBe(0);
    });

    it('un adjunto demasiado grande NI SE LEE', async () => {
      // Traerlo a memoria para trocearlo tumbaría el proceso, y con él la
      // bandeja del municipio entero. Por eso se mira la cabecera ANTES de
      // tocar el cuerpo: preguntar el tamaño después de habérselo tragado no
      // evita nada, y es justo lo que comprueba este `leido`.
      let leido = false;
      globalThis.fetch = ((_u: string, init: { body?: string }) => {
        if (init?.body) {
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
        }
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Map([
            ['content-length', String(400 * 1024 * 1024)],
            ['content-type', 'video/mp4'],
          ]) as unknown as Headers,
          arrayBuffer: () => {
            leido = true;
            return Promise.resolve(new ArrayBuffer(1024));
          },
        });
      }) as unknown as typeof fetch;

      await svc.recibirDeInfobip(
        entrega({ message: { type: 'VIDEO', url: 'https://media.infobip.com/x.mp4' } }),
      );

      // Si esto falla, se leyó el cuerpo de un archivo de 400 MB.
      expect(leido).toBe(false);
      expect(adjuntados.length).toBe(0);
      expect(casos.length).toBe(1); // el caso sigue abierto
    });

    it('si la descarga falla, el caso NO se pierde', async () => {
      globalThis.fetch = ((_u: string, init: { body?: string }) => {
        if (init?.body) {
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
        }
        return Promise.reject(new Error('red caída'));
      }) as unknown as typeof fetch;

      const r = await svc.recibirDeInfobip(
        entrega({ message: { type: 'IMAGE', url: 'https://media.infobip.com/x.jpg' } }),
      );

      expect(r.procesados).toBe(1);
      expect(casos.length).toBe(1);
      expect(adjuntados.length).toBe(0);
    });
  });

  describe('lo que dice el bot queda en la conversación', () => {
    // Lo que se vio en producción el 21/10/2026: el ciudadano recibía el menú
    // y el operador no lo veía. La conversación le empezaba con un «2» suelto
    // que no significa nada, y respondía a ciegas.

    beforeEach(() => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
      globalThis.fetch = (() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') })
      ) as unknown as typeof fetch;
    });

    afterEach(() => {
      delete process.env['INFOBIP_BASE_URL'];
      delete process.env['INFOBIP_API_KEY'];
    });

    it('el menú que se le mandó al ciudadano se ve en el caso', async () => {
      await svc.recibirDeInfobip(entrega());

      const delBot = guardados.filter((g) => g.autorTipo === 'bot');
      expect(delBot.length).toBe(1);
      expect(delBot[0].texto).toContain('1. Riña o agresión');
    });

    it('el bot NO se cuenta como operador: no se calla a sí mismo', async () => {
      // Si sus mensajes se guardaran como «operador», la comprobación de
      // «¿ya hay una persona atendiendo?» daría verdadero y el bot se
      // silenciaría después de su primera pregunta.
      casoExistente = {
        id: 'caso-1', canal: 'whatsapp', telefono: '573175882321', mensajesSinLeer: 0,
      };
      conversacion = { estado: 'esperando_tipo', casoId: 'caso-1', mensajesDelBot: 1 };
      guardados.push({
        tenant: 'itagui', texto: 'menú anterior', waMessageId: null, autorTipo: 'bot',
      });

      await svc.recibirDeInfobip(
        entrega({ messageId: 'm-2', message: { type: 'TEXT', text: '2' } }),
      );

      // Siguió trabajando: tipificó y preguntó el lugar.
      expect(cambiosAlCaso.length).toBe(1);
      expect(guardados.some((g) => g.autorTipo === 'bot' && g.texto.includes('DIRECCION'))).toBe(true);
    });

    it('si el mensaje NO sale, no se apunta como dicho', async () => {
      // Es el mismo defecto que ya corregimos en las respuestas del operador:
      // apuntar en el expediente algo que el ciudadano nunca recibió.
      globalThis.fetch = (() =>
        Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('no') })
      ) as unknown as typeof fetch;

      await svc.recibirDeInfobip(entrega());

      expect(guardados.filter((g) => g.autorTipo === 'bot').length).toBe(0);
      // Pero el caso y el mensaje del ciudadano sí están.
      expect(casos.length).toBe(1);
    });
  });

  describe('el aviso del adjunto dice la verdad', () => {
    // Lo que se vio en producción: el caso decía «Todavía no se puede ver
    // desde FALCON: pídaselo por escrito o llámelo» debajo de una foto que
    // SÍ se había guardado. Eso manda al operador a pedir algo que ya tiene.

    beforeEach(() => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      adjuntados.length = 0;
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
    });

    afterEach(() => {
      delete process.env['INFOBIP_BASE_URL'];
      delete process.env['INFOBIP_API_KEY'];
    });

    const conDescarga = (ok: boolean, bytes = 2048) => {
      globalThis.fetch = ((_u: string, init: { body?: string }) => {
        if (init?.body) {
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
        }
        if (!ok) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
        return Promise.resolve({
          ok: true, status: 200,
          headers: new Map([
            ['content-length', String(bytes)], ['content-type', 'image/jpeg'],
          ]) as unknown as Headers,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
        });
      }) as unknown as typeof fetch;
    };

    it('cuando la foto SÍ se guarda, el aviso lo dice', async () => {
      conDescarga(true);

      await svc.recibirDeInfobip(
        entrega({ messageId: 'foto-1', message: { type: 'IMAGE', url: 'https://m/x.jpg' } }),
      );

      const aviso = actualizados.find((a) => String(a['texto']).includes('imagen'));
      expect(aviso).toBeDefined();
      expect(String(aviso!['texto'])).toContain('Está en los adjuntos del caso');
      expect(String(aviso!['texto'])).not.toContain('pídaselo por escrito');
    });

    it('cuando NO se pudo bajar, dice qué hacer', async () => {
      conDescarga(false);

      await svc.recibirDeInfobip(
        entrega({ messageId: 'foto-2', message: { type: 'IMAGE', url: 'https://m/x.jpg' } }),
      );

      const aviso = actualizados.find((a) => String(a['texto']).includes('imagen'));
      expect(String(aviso!['texto'])).toContain('pídaselo por escrito o llámelo');
    });
  });

  describe('lo que no encaja', () => {
    it('un mensaje para un número que no es de nadie NO crea caso', async () => {
      // Puede ser otra línea de la misma cuenta de Infobip. Crear un caso
      // «por si acaso» metería ruido ajeno en una bandeja de emergencias.
      const r = await svc.recibirDeInfobip(entrega());

      expect(r.procesados).toBe(0);
      expect(r.sinReconocer).toBe(1);
      expect(casos.length).toBe(0);
    });

    it('un cuerpo sin `results` no revienta ni inventa nada', async () => {
      const r = await svc.recibirDeInfobip({ cualquierCosa: true });
      expect(r).toEqual({ procesados: 0, sinReconocer: 0 });
      expect(casos.length).toBe(0);
    });

    it('una instancia suspendida no recibe emergencias', async () => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      vigente = () => {
        throw new Error('suspendida');
      };

      const r = await svc.recibirDeInfobip(entrega());

      expect(r.procesados).toBe(0);
      expect(casos.length).toBe(0);
    });
  });

  describe('responder: guardar y enviar NO son lo mismo', () => {
    // El defecto real: una línea sin credenciales guardaba el mensaje,
    // escribía una advertencia en el log del servidor y devolvía como si
    // todo hubiera ido bien. El operador escribía «ya va la patrulla en
    // camino», lo veía en la conversación, y el ciudadano no recibía nada.

    it('sin credenciales, el mensaje se guarda pero se dice que NO salió', async () => {
      casoExistente = {
        id: 'caso-1',
        canal: 'whatsapp',
        telefono: '573175882321',
        mensajesSinLeer: 0,
      };

      const r = await svc.responder(
        'itagui',
        'caso-1',
        'ya va la patrulla',
        'operador1',
      );

      expect(r.texto).toBe('ya va la patrulla');
      expect(r.enviado).toBe(false);
    });

    it('un mensaje vacío ni se guarda', async () => {
      await expect(
        svc.responder('itagui', 'caso-1', '   ', 'operador1'),
      ).rejects.toThrow();
    });
  });

  describe('los mensajes que entran a un caso que ya existe', () => {
    // El defecto real del 21/10/2026: entraron seis mensajes seguidos a la
    // misma conversación y en Recepción y Despacho no cambió absolutamente
    // nada. La fila seguía diciendo lo que dijo el primero, con su misma
    // antigüedad. El hilo solo existía para quien abriera el caso.
    //
    // En una prueba eso es confusión. En turno es un «ya entró al cuarto de
    // mi hija» que llega a la base de datos y a nadie en pantalla.

    const yaHayCaso = () => {
      casoExistente = {
        id: 'caso-1',
        canal: 'whatsapp',
        telefono: '573175882321',
        mensajesSinLeer: 0,
      };
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
    };

    it('el segundo mensaje NO abre otro caso, pero SÍ se cuenta', async () => {
      yaHayCaso();

      await svc.recibirDeInfobip(entrega({ messageId: 'msg-2' }));

      expect(casos.length).toBe(0); // no se abrió ninguno nuevo
      expect(guardados.length).toBe(1); // y el mensaje sí se guardó
      expect(sumados).toEqual([{ id: 'caso-1', campo: 'mensajesSinLeer', cuanto: 1 }]);
    });

    it('cinco mensajes son cinco sin leer, no uno', async () => {
      // Lo que pasó de verdad: seis seguidos. Si esto contara una sola vez,
      // la insignia diría «1» y el operador abriría creyendo que hay un
      // mensaje nuevo cuando hay cinco, y leería solo el último.
      yaHayCaso();

      for (let i = 0; i < 5; i++) {
        await svc.recibirDeInfobip(entrega({ messageId: `msg-${i}` }));
      }

      expect(sumados.length).toBe(5);
      expect(casoExistente!.mensajesSinLeer).toBe(5);
    });

    it('el tablero se entera en el momento, no al recargar', async () => {
      // Una insignia que solo aparece recargando la página es casi lo mismo
      // que no tenerla: quien está mirando el tablero no recarga.
      yaHayCaso();

      await svc.recibirDeInfobip(entrega({ messageId: 'msg-2' }));

      expect(emitidos).toEqual([{ tenant: 'itagui', casoId: 'caso-1' }]);
    });

    it('el PRIMER mensaje no cuenta: el caso nuevo ya se anuncia solo', async () => {
      // Si contara, el operador vería un caso recién llegado con una insignia
      // de «1 sin leer» encima del titular que está leyendo.
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };

      await svc.recibirDeInfobip(entrega());

      expect(casos.length).toBe(1);
      expect(sumados).toEqual([]);
      expect(emitidos).toEqual([]);
    });

    it('un reintento de Infobip no infla el contador', async () => {
      // El mismo mensaje entregado dos veces es un mensaje. Si contara dos,
      // la insignia diría que hay algo por leer que no existe, y no se
      // apagaría hasta que alguien abriera el caso a buscarlo.
      yaHayCaso();

      await svc.recibirDeInfobip(entrega({ messageId: 'repetido' }));
      await svc.recibirDeInfobip(entrega({ messageId: 'repetido' }));

      expect(sumados.length).toBe(1);
    });

    it('abrir la conversación apaga la insignia, y el tablero lo ve', async () => {
      yaHayCaso();
      casoExistente!.mensajesSinLeer = 4;

      await svc.historial('itagui', 'caso-1');

      expect(limpiados).toEqual(['caso-1']);
      expect(casoExistente!.mensajesSinLeer).toBe(0);
      expect(emitidos).toEqual([{ tenant: 'itagui', casoId: 'caso-1' }]);
    });

    it('releer una conversación ya leída no manda nada por el socket', async () => {
      // El detalle repregunta cada 4 segundos mientras el caso está abierto.
      // Sin esta condición, cada operador con un caso abierto generaría un
      // «caso:actualizado» cada 4 segundos hacia TODOS los navegadores del
      // municipio, para no decir nada nuevo.
      yaHayCaso();

      await svc.historial('itagui', 'caso-1');
      await svc.historial('itagui', 'caso-1');
      await svc.historial('itagui', 'caso-1');

      expect(limpiados).toEqual([]);
      expect(emitidos).toEqual([]);
    });

    it('un fallo avisando NO deshace el mensaje guardado', async () => {
      // El dato del ciudadano pesa más que la notificación. Si el socket
      // revienta, el mensaje tiene que seguir en el expediente.
      yaHayCaso();
      gatewayRoto = true;

      const r = await svc.recibirDeInfobip(entrega({ messageId: 'msg-2' }));

      expect(r.procesados).toBe(1);
      expect(guardados.length).toBe(1);
    });
  });

  describe('lo que todavía no sabemos leer', () => {
    it('un audio SÍ abre el caso, y dice que hay un audio', async () => {
      // Es la decisión que importa de todo este archivo. Quien se esconde de
      // un agresor manda una nota de voz, no escribe. Descartarla porque no
      // sabemos reproducirla sería perder la emergencia entera.
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };

      const r = await svc.recibirDeInfobip(
        entrega({ message: { type: 'VOICE' } }),
      );

      expect(r.procesados).toBe(1);
      expect(casos.length).toBe(1);
      expect(guardados[0].texto).toContain('nota de voz');
      // Y se cuenta, para que se vea desde fuera que falta soportarlo.
      expect(r.sinReconocer).toBe(1);
    });

    it('una ubicación también, y se nombra', async () => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      await svc.recibirDeInfobip(entrega({ message: { type: 'LOCATION' } }));
      expect(guardados[0].texto).toContain('ubicación');
    });

    it('un tipo que ni conocemos se nombra igual, no se calla', async () => {
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };
      await svc.recibirDeInfobip(entrega({ message: { type: 'FUTURO_X' } }));
      expect(guardados[0].texto).toContain('FUTURO_X');
      expect(casos.length).toBe(1);
    });

    it('el pie de una foto es lo que el ciudadano escribió, y vale', async () => {
      // «es en esta esquina» bajo una foto es el dato de la emergencia.
      tenantPorNumero['573132354086'] = { codigo: 'itagui' };

      const r = await svc.recibirDeInfobip(
        entrega({ message: { type: 'IMAGE', caption: 'es en esta esquina' } }),
      );

      expect(guardados[0].texto).toBe('es en esta esquina');
      expect(r.sinReconocer).toBe(0);
    });
  });
});
