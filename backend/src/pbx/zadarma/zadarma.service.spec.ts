import { Repository } from 'typeorm';
import { ConfigPbxEntity } from '../config-pbx.entity';
import { TenantEntity } from '../../tenants/tenant.entity';
import { PbxService, WebhookLlamadaDto } from '../pbx.service';
import { ZadarmaService, fechaIso } from './zadarma.service';
import { cifrar } from '../../common/secretos';

/**
 * El traductor de Zadarma.
 *
 * Lo que se protege: que una llamada de verdad —que llega en cuatro avisos y
 * no en uno— termine siendo UNA llamada en la cola, con el operador correcto;
 * y que lo que no es una llamada entrante no se cuele en esa cola.
 *
 * El modelo interno (`entrante`/`colgada`) no se toca: es el mismo que usa la
 * planta de YACO en producción. Aquí solo se comprueba la traducción.
 */
describe('ZadarmaService', () => {
  const TENANT = { codigo: '63001', nombre: 'Alcaldía de Soacha' } as TenantEntity;

  /** La secuencia real de una llamada contestada por la extensión 101. */
  const LLAMADA = {
    inicio: {
      event: 'NOTIFY_START', caller_id: '573001234567', called_did: '576012345678',
      call_start: '2026-10-15 09:12:33', pbx_call_id: 'in-abc123',
    },
    ofrecida: {
      event: 'NOTIFY_INTERNAL', caller_id: '573001234567', called_did: '576012345678',
      call_start: '2026-10-15 09:12:33', pbx_call_id: 'in-abc123', internal: '101',
    },
    contestada: {
      event: 'NOTIFY_ANSWER', caller_id: '573001234567', destination: '101',
      call_start: '2026-10-15 09:12:33', pbx_call_id: 'in-abc123', internal: '101',
    },
    colgada: {
      event: 'NOTIFY_END', caller_id: '573001234567', called_did: '576012345678',
      call_start: '2026-10-15 09:12:33', pbx_call_id: 'in-abc123', internal: '101',
      disposition: 'answered', duration: '94',
    },
  };

  let enviados: WebhookLlamadaDto[];
  let svc: ZadarmaService;

  function armar(cfg: Partial<ConfigPbxEntity> | null = { proveedor: 'ZADARMA', activo: true }) {
    enviados = [];
    const config = {
      findOne: async () => (cfg ? ({ tenant: '63001', ...cfg } as ConfigPbxEntity) : null),
    } as unknown as Repository<ConfigPbxEntity>;
    const pbx = {
      webhook: async (_t: TenantEntity, dto: WebhookLlamadaDto) => {
        enviados.push(dto);
        return { id: `ll-${enviados.length}` };
      },
    } as unknown as PbxService;
    svc = new ZadarmaService(config, pbx);
  }

  beforeEach(() => armar());

  it('la llamada entra a la cola apenas timbra, sin esperar destino', async () => {
    // Es lo que distingue un CAD de un registro: el operador ve el número
    // mientras suena, no cuando ya contestó.
    await svc.procesar(TENANT, LLAMADA.inicio);

    expect(enviados.length).toBe(1);
    expect(enviados[0].evento).toBe('entrante');
    expect(enviados[0].numero).toBe('573001234567');
    expect(enviados[0].callId).toBe('in-abc123');
    expect(enviados[0].extension).toBeUndefined();
  });

  it('cuando la central decide la extensión, completa la MISMA llamada', async () => {
    await svc.procesar(TENANT, LLAMADA.inicio);
    await svc.procesar(TENANT, LLAMADA.ofrecida);

    expect(enviados.length).toBe(2);
    // El mismo callId: `PbxService` lo reconoce y no duplica la fila.
    expect(enviados[1].callId).toBe('in-abc123');
    expect(enviados[1].evento).toBe('entrante');
    expect(enviados[1].extension).toBe('101');
  });

  it('contestar NO la marca como atendida en FALCON', async () => {
    // «Atendida» significa que alguien la tomó desde la aplicación y se le
    // abrió el caso. Mientras se conteste por softphone son dos cosas
    // distintas, y fingir que son una dejaría casos vacíos en el tablero.
    await svc.procesar(TENANT, LLAMADA.inicio);
    await svc.procesar(TENANT, LLAMADA.contestada);

    expect(enviados.map((d) => d.evento)).toEqual(['entrante', 'entrante']);
    expect(enviados[1].agente).toBe('101');
  });

  it('colgar cierra la llamada', async () => {
    await svc.procesar(TENANT, LLAMADA.inicio);
    const r = await svc.procesar(TENANT, LLAMADA.colgada);

    expect(enviados[1].evento).toBe('colgada');
    expect(enviados[1].callId).toBe('in-abc123');
    expect(r.resumen).toContain('answered');
    expect(r.resumen).toContain('94');
  });

  describe('una llamada contestada por softphone no es una llamada perdida', () => {
    // «Llamadas perdidas del 123» es una cifra que el municipio reporta. Si un
    // operador descuelga en MicroSIP y atiende al ciudadano sin tocar FALCON,
    // esa llamada NO puede acabar contada como perdida.
    it('la central dice answered → se avisa que la atendieron por fuera', async () => {
      await svc.procesar(TENANT, LLAMADA.inicio);
      await svc.procesar(TENANT, LLAMADA.colgada);
      expect(enviados[1].atendidaEnPlanta).toBe(true);
    });

    it('sin contestar (no answer) sigue siendo perdida', async () => {
      await svc.procesar(TENANT, LLAMADA.inicio);
      await svc.procesar(TENANT, { ...LLAMADA.colgada, disposition: 'no answer' });
      expect(enviados[1].atendidaEnPlanta).toBe(false);
    });

    it('ocupado o cancelada, tampoco', async () => {
      for (const d of ['busy', 'cancel', '']) {
        armar();
        await svc.procesar(TENANT, { ...LLAMADA.colgada, disposition: d });
        expect(enviados[0].atendidaEnPlanta).toBe(false);
      }
    });
  });

  it('una llamada SALIENTE no entra a la cola', async () => {
    // La cola de un CAD es de lo que entra. Meter ahí lo que marca un
    // operador la vuelve inútil en el primer turno.
    const r = await svc.procesar(TENANT, {
      event: 'NOTIFY_OUT_START', internal: '101', destination: '573009999999',
      call_start: '2026-10-15 10:00:00', pbx_call_id: 'out-1',
    });

    expect(enviados.length).toBe(0);
    expect(r.resumen).toContain('no entra a la cola');
  });

  it('un evento que no sabemos traducir no revienta ni se reintenta', async () => {
    // Zadarma reintenta lo que no recibe un 200, y un reintento infinito de
    // un evento que no nos interesa no arregla nada.
    const r = await svc.procesar(TENANT, { event: 'SPEECH_RECOGNITION', pbx_call_id: 'x' });

    expect(enviados.length).toBe(0);
    expect(r.cuerpo).toEqual({ ok: true });
  });

  it('la hora de la central viaja como ISO, y una basura no tumba la llamada', async () => {
    await svc.procesar(TENANT, LLAMADA.inicio);
    expect(enviados[0].fechaHora).toBe('2026-10-15T09:12:33');

    await svc.procesar(TENANT, { ...LLAMADA.inicio, call_start: 'ayer por la tarde' });
    expect(enviados[1].fechaHora).toBeUndefined();
    expect(enviados[1].numero).toBe('573001234567');
  });

  describe('el secreto', () => {
    it('se descifra para poder verificar firmas', () => {
      process.env.JWT_SECRET = 'llave-de-prueba';
      const cfg = { zadarmaSecreto: cifrar('secreto-real', 'llave-de-prueba') } as ConfigPbxEntity;
      expect(svc.secretoDe(cfg)).toBe('secreto-real');
    });

    it('si la llave de cifrado cambió, devuelve vacío en vez de reventar', () => {
      // Vacío hace que la verificación falle y el webhook rechace, que es lo
      // correcto: sin secreto no se puede comprobar nada.
      process.env.JWT_SECRET = 'otra-llave';
      const cfg = { tenant: '63001', zadarmaSecreto: cifrar('secreto-real', 'llave-vieja') } as ConfigPbxEntity;
      expect(svc.secretoDe(cfg)).toBe('');
    });

    it('sin configuración no hay secreto', () => {
      expect(svc.secretoDe(null)).toBe('');
    });
  });
});

describe('la hora de la central', () => {
  it('«2026-10-15 09:12:33» pasa a ISO sin inventar zona horaria', () => {
    expect(fechaIso('2026-10-15 09:12:33')).toBe('2026-10-15T09:12:33');
  });

  it('lo que ya viene en ISO se respeta', () => {
    expect(fechaIso('2026-10-15T09:12:33-05:00')).toBe('2026-10-15T09:12:33-05:00');
  });

  it('vacío o imposible se omite: el instante que vale es el de FALCON', () => {
    expect(fechaIso('')).toBeUndefined();
    expect(fechaIso(undefined)).toBeUndefined();
    expect(fechaIso('MMDDAA 09:12')).toBeUndefined();
  });
});
