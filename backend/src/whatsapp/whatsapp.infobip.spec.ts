import { Test } from '@nestjs/testing';

import { CasosGateway } from '../casos/casos.gateway';
import { CasosService } from '../casos/casos.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappService } from './whatsapp.service';

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
  }[];
  /** Los casos creados. */
  let casos: { tenant: string; telefono: string; descripcion: string }[];
  /** Identificadores ya vistos, para la prueba de reintento. */
  let yaVistos: Set<string>;
  let vigente: () => void;
  /** El caso que encuentra la búsqueda. Nulo = no hay, y se abre uno. */
  let casoExistente:
    | { id: string; canal: string; telefono: string; mensajesSinLeer: number }
    | null;
  /** Cada `increment` sobre el contador de mensajes sin leer. */
  let sumados: { id: string; campo: string; cuanto: number }[];
  /** Los casos cuyo contador se puso a cero. */
  let limpiados: string[];
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
    sumados = [];
    limpiados = [];
    emitidos = [];
    gatewayRoto = false;

    const mensajesRepo = {
      findOne: ({ where }: { where: { waMessageId?: string } }) =>
        Promise.resolve(
          where.waMessageId && yaVistos.has(where.waMessageId) ? {} : null,
        ),
      create: (x: unknown) => x,
      find: () => Promise.resolve(guardados),
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
      update: (donde: { id: string }, cambios: { mensajesSinLeer: number }) => {
        limpiados.push(donde.id);
        if (casoExistente) casoExistente.mensajesSinLeer = cambios.mensajesSinLeer;
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
            porCodigo: (c: string) => Promise.resolve({ codigo: c }),
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
                  e?.name === 'CasoEntity' ? casosRepo : mensajesRepo,
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
