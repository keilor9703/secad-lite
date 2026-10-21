import { Test } from '@nestjs/testing';

import { CasosGateway } from '../casos/casos.gateway';
import { CasosService } from '../casos/casos.service';
import { TenantRlsService } from '../common/tenant-rls.service';
import { TenantsService } from '../tenants/tenants.service';
import { WhatsappService } from './whatsapp.service';

/**
 * «QUÉ ME FALTA PARA QUE ESTO FUNCIONE».
 *
 * Hasta ahora la pantalla de WhatsApp no decía nada: si faltaba una pieza,
 * los mensajes simplemente no llegaban, y averiguar por qué costaba entrar al
 * servidor a leer `docker logs`. Eso es asumible la primera vez; con un
 * municipio nuevo cada mes, no.
 *
 * Lo que se comprueba aquí no es que la lista exista: es que diga la pieza
 * CORRECTA. Una lista que acusa al campo equivocado es peor que no tener
 * lista, porque manda a quien configura a cambiar algo que estaba bien.
 */
describe('WhatsappService · qué le falta a la línea', () => {
  let svc: WhatsappService;
  let tenant: Record<string, unknown>;
  let tokenMeta: string | null;
  /** Mensajes en la base, para el contador de movimiento. */
  let mensajes: { autorTipo: string; creadoEn: Date }[];

  const ENV = ['INFOBIP_BASE_URL', 'INFOBIP_API_KEY', 'INFOBIP_WEBHOOK_TOKEN'];

  beforeEach(async () => {
    for (const k of ENV) delete process.env[k];
    tenant = { codigo: 'itagui' };
    tokenMeta = null;
    mensajes = [];

    const modulo = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: CasosService, useValue: { crear: () => Promise.resolve({ id: 'x' }) } },
        { provide: CasosGateway, useValue: { emitirCambio: () => undefined } },
        {
          provide: TenantsService,
          useValue: {
            porCodigo: () => Promise.resolve(tenant),
            porWaNumero: () => Promise.resolve(null),
            waAccessTokenDe: () => Promise.resolve(tokenMeta),
            asegurarVigente: () => undefined,
          },
        },
        {
          provide: TenantRlsService,
          useValue: {
            conTenant: (_t: string, fn: (m: unknown) => unknown) =>
              fn({
                getRepository: () => ({
                  count: ({ where }: { where: { autorTipo: string } }) =>
                    Promise.resolve(
                      mensajes.filter((m) => m.autorTipo === where.autorTipo).length,
                    ),
                  findOne: () =>
                    Promise.resolve(
                      mensajes.filter((m) => m.autorTipo === 'ciudadano').at(-1) ?? null,
                    ),
                  createQueryBuilder: () => {
                    const qb = {
                      where: () => qb, andWhere: () => qb, orderBy: () => qb,
                      getOne: () => Promise.resolve(null),
                    };
                    return qb;
                  },
                }),
              }),
          },
        },
      ],
    }).compile();

    svc = modulo.get(WhatsappService);
  });

  afterEach(() => {
    for (const k of ENV) delete process.env[k];
  });

  /** El servidor con las credenciales de la cuenta puestas. */
  const servidorListo = () => {
    process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
    process.env['INFOBIP_API_KEY'] = 'clave';
    process.env['INFOBIP_WEBHOOK_TOKEN'] = 'token';
  };

  const textos = (fs: { que: string }[]) => fs.map((f) => f.que).join(' | ');

  describe('acusa a la pieza correcta', () => {
    it('sin número, lo primero que falta es el número', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waAgenciaResponsableId: 'ag-1' };

      const e = await svc.estado('itagui');

      expect(e.listo).toBe(false);
      expect(e.via).toBeNull();
      expect(e.faltan[0].que).toContain('número de línea');
      expect(e.faltan[0].comoSeArregla).toContain('573132354086');
    });

    it('con número pero sin credenciales, acusa AL SERVIDOR y no al municipio', async () => {
      // Es la distinción que ahorra la llamada de soporte: esto no lo arregla
      // el administrador del municipio por mucho que mire su pantalla.
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };

      const e = await svc.estado('itagui');

      expect(e.faltan.length).toBe(1);
      expect(e.faltan[0].esDelServidor).toBe(true);
      expect(e.faltan[0].comoSeArregla).toContain('INFOBIP_API_KEY');
    });

    it('con credenciales de envío pero sin token de webhook: envía y NO recibe', async () => {
      // El caso traicionero: la prueba de envío sale bien y el administrador
      // da la línea por buena, mientras cada mensaje entrante se rechaza.
      process.env['INFOBIP_BASE_URL'] = 'ejemplo.api.infobip.com';
      process.env['INFOBIP_API_KEY'] = 'clave';
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };

      const e = await svc.estado('itagui');

      expect(textos(e.faltan)).toContain('NO recibir');
      expect(e.faltan[0].esDelServidor).toBe(true);
    });

    it('sin agencia responsable, avisa de que nadie despacharía el caso', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086' };

      const e = await svc.estado('itagui');

      expect(e.via).toBe('infobip');
      expect(textos(e.faltan)).toContain('bandeja');
      expect(e.listo).toBe(false);
    });

    it('todo puesto: no falta nada', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };

      const e = await svc.estado('itagui');

      expect(e.faltan).toEqual([]);
      expect(e.listo).toBe(true);
      expect(e.via).toBe('infobip');
    });

    it('una línea de Meta a medias se señala como tal', async () => {
      tenant = { codigo: 'itagui', waPhoneNumberId: '109999888', waAgenciaResponsableId: 'ag-1' };
      tokenMeta = null;

      const e = await svc.estado('itagui');

      expect(e.via).toBeNull();
      // Lo accionable está en «cómo se arregla»: decir «está a medias» sin
      // decir QUÉ mitad deja a quien configura en el mismo sitio.
      expect(e.faltan[0].comoSeArregla).toContain('token de acceso de Meta');
    });

    it('una línea de Meta completa es válida, sin Infobip por ningún lado', async () => {
      tenant = { codigo: 'itagui', waPhoneNumberId: '109999888', waAgenciaResponsableId: 'ag-1' };
      tokenMeta = 'token-de-meta';

      const e = await svc.estado('itagui');

      expect(e.via).toBe('meta');
      expect(e.listo).toBe(true);
    });
  });

  describe('el movimiento de la línea', () => {
    it('cuenta entrantes y salientes por separado', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };
      mensajes = [
        { autorTipo: 'ciudadano', creadoEn: new Date() },
        { autorTipo: 'ciudadano', creadoEn: new Date() },
        { autorTipo: 'operador', creadoEn: new Date() },
      ];

      const e = await svc.estado('itagui');

      expect(e.consumo.entrantes).toBe(2);
      expect(e.consumo.salientes).toBe(1);
      expect(e.consumo.dias).toBe(30);
    });

    it('una línea sin estrenar da cero y sin último entrante', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };

      const e = await svc.estado('itagui');

      expect(e.consumo.entrantes).toBe(0);
      expect(e.ultimoEntrante).toBeNull();
    });
  });

  describe('la prueba de la línea', () => {
    it('sin configurar, dice qué falta en vez de un «falló» pelado', async () => {
      tenant = { codigo: 'itagui' };

      const r = await svc.probar('itagui', '573175882321');

      expect(r.ok).toBe(false);
      expect(r.detalle).toContain('número de línea');
    });

    it('sin número de destino no se intenta nada', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };

      const r = await svc.probar('itagui', '');

      expect(r.ok).toBe(false);
      expect(r.detalle).toContain('Escriba el número');
    });

    it('si el proveedor lo rechaza, explica la trampa de las 24 horas', async () => {
      // Es la que se lleva a todo el mundo la primera vez: WhatsApp no deja
      // escribirle primero a nadie, y eso NO significa que la configuración
      // esté mal. Un «falló» a secas manda a revisar lo que estaba bien.
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };
      globalThis.fetch = (() =>
        Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('{"error":"no session"}') })
      ) as unknown as typeof fetch;

      const r = await svc.probar('itagui', '573175882321');

      expect(r.ok).toBe(false);
      expect(r.detalle).toContain('400');
      expect(r.detalle).toContain('escribir primero');
      // Y dice a qué número tiene que escribir, que es lo accionable.
      expect(r.detalle).toContain('573132354086');
    });

    it('si sale, lo dice y dice por dónde salió', async () => {
      servidorListo();
      tenant = { codigo: 'itagui', waNumero: '573132354086', waAgenciaResponsableId: 'ag-1' };
      globalThis.fetch = (() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') })
      ) as unknown as typeof fetch;

      const r = await svc.probar('itagui', '573175882321');

      expect(r.ok).toBe(true);
      expect(r.detalle).toContain('Infobip');
    });
  });
});
