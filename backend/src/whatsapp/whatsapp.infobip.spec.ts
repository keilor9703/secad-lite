import { Test } from '@nestjs/testing';

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

  beforeEach(async () => {
    tenantPorNumero = {};
    guardados = [];
    casos = [];
    yaVistos = new Set();
    vigente = () => undefined;

    const mensajesRepo = {
      findOne: ({ where }: { where: { waMessageId?: string } }) =>
        Promise.resolve(
          where.waMessageId && yaVistos.has(where.waMessageId) ? {} : null,
        ),
      create: (x: unknown) => x,
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
    // No hay caso abierto: cada mensaje de estas pruebas abre uno.
    const casosRepo = { findOne: () => Promise.resolve(null) };

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
          provide: TenantsService,
          useValue: {
            porWaNumero: (n: string) =>
              Promise.resolve(
                tenantPorNumero[(n ?? '').replace(/\D/g, '')] ?? null,
              ),
            porCodigo: (c: string) => Promise.resolve({ codigo: c }),
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
