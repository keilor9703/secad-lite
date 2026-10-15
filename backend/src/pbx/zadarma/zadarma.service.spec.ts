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
  /** Las llamadas que «existen» en la base, por callId — como en `PbxService`. */
  let enCola: Map<string, { id: string; estado: string }>;
  /** Y cuáles ya se cerraron: una fila cerrada no desaparece de la base. */
  let cerradas: Set<string>;

  function armar(cfg: Partial<ConfigPbxEntity> | null = { proveedor: 'ZADARMA', activo: true }) {
    enviados = [];
    enCola = new Map();
    cerradas = new Set();
    const config = {
      findOne: async () => (cfg ? ({ tenant: '63001', ...cfg } as ConfigPbxEntity) : null),
    } as unknown as Repository<ConfigPbxEntity>;
    const pbx = {
      webhook: async (_t: TenantEntity, dto: WebhookLlamadaDto) => {
        enviados.push(dto);
        const llamada = enCola.get(dto.callId ?? '') ?? { id: `ll-${enviados.length}`, estado: 'sonando' };
        if (dto.callId) enCola.set(dto.callId, llamada);
        return llamada;
      },
      // Igual que el de verdad, y esto importó: devuelve null cuando no hay
      // nada que cerrar —en vez de lanzar un 404 que Zadarma reintentaría sin
      // fin— y la llamada SIGUE existiendo después de cerrada, con
      // `cambio: false`. La primera versión de este doble la borraba del
      // mapa, así que un fin repetido parecía «nada que cerrar»; en la base
      // de verdad la fila sigue ahí y la bitácora anotaba «Colgada» dos
      // veces. Lo descubrió el tráfico real, no esta prueba.
      cerrarSiEstaEnCola: async (_t: TenantEntity, dto: WebhookLlamadaDto) => {
        enviados.push(dto);
        const llamada = enCola.get(dto.callId ?? '');
        if (!llamada) return null;
        const cambio = !cerradas.has(dto.callId ?? '');
        if (dto.callId) cerradas.add(dto.callId);
        return { llamada, cambio };
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

  /**
   * EL FIN DE LA LLAMADA NO TIENE UN SOLO NOMBRE.
   *
   * Pasó en la primera prueba real, entre dos extensiones: la llamada entró a
   * la cola por `NOTIFY_INTERNAL` y al colgar NO se cerró en FALCON —siguió
   * timbrando y hubo que cerrarla a mano por la API—, porque desde la
   * extensión que marcó ese fin es una SALIENTE y llega como
   * `NOTIFY_OUT_END`, que se ignoraba por «saliente».
   *
   * Lo que decide, entonces, no es el nombre del evento: es el `pbx_call_id`.
   */
  describe('cualquier aviso de fin cierra la llamada que nombra', () => {
    const FIN = {
      caller_id: '101', called_did: '102', call_start: '2026-10-15 09:12:33',
      pbx_call_id: 'in-abc123', internal: '102', disposition: 'answered', duration: '12',
    };

    it('NOTIFY_OUT_END cierra la llamada interna que sí estaba en la cola', async () => {
      await svc.procesar(TENANT, LLAMADA.ofrecida);
      const r = await svc.procesar(TENANT, { ...FIN, event: 'NOTIFY_OUT_END' });

      expect(enviados[1].evento).toBe('colgada');
      expect(enviados[1].callId).toBe('in-abc123');
      expect(enviados[1].atendidaEnPlanta).toBe(true);
      expect(r.resumen).toContain('Colgada');
      expect(r.llamadaId).toBeTruthy();
      // Y NO pisa al agente: en un fin de saliente `internal` es quien
      // MARCÓ (101), no quien contestó (102). Se vio en la primera llamada
      // real: la llamada quedó atribuida a la extensión equivocada.
      expect(enviados[1].agente).toBeUndefined();
    });

    it('NOTIFY_INTERNAL_END también', async () => {
      await svc.procesar(TENANT, LLAMADA.ofrecida);
      const r = await svc.procesar(TENANT, { ...FIN, event: 'NOTIFY_INTERNAL_END' });

      expect(enviados[1].evento).toBe('colgada');
      expect(r.llamadaId).toBeTruthy();
    });

    it('pero una saliente de VERDAD no cierra nada, y lo dice', async () => {
      // Nunca creó fila, así que no hay nada que cerrar. Tratarlo como un
      // `colgada` cualquiera respondería 404, y Zadarma reintenta los 404.
      const r = await svc.procesar(TENANT, {
        event: 'NOTIFY_OUT_END', internal: '101', destination: '573009999999',
        call_start: '2026-10-15 10:00:00', pbx_call_id: 'out-1', disposition: 'answered', duration: '30',
      });

      expect(r.llamadaId).toBeUndefined();
      expect(r.resumen).toContain('nada que cerrar');
      expect(r.cuerpo).toEqual({ ok: true });
    });

    it('el fin repetido lo dice, en vez de anotar la llamada colgada dos veces', async () => {
      // Zadarma puede contar el fin dos veces (la pata interna y la
      // saliente). La segunda no mueve la cola del operador —eso lo
      // garantiza `PbxService`— pero sí tiene que distinguirse en la
      // bitácora: dos «Colgada» seguidas por la misma llamada se leen como
      // dos cosas que pasaron, y mandan a buscar un problema que no existe.
      await svc.procesar(TENANT, LLAMADA.ofrecida);
      const primero = await svc.procesar(TENANT, { ...FIN, event: 'NOTIFY_INTERNAL_END' });
      const segundo = await svc.procesar(TENANT, { ...FIN, event: 'NOTIFY_OUT_END' });

      expect(primero.resumen).toContain('Colgada');
      expect(segundo.resumen).toContain('Ya estaba cerrada');
      expect(segundo.resumen).not.toContain('Colgada (');
    });

    it('un fin de una llamada que FALCON nunca vio no revienta ni se reintenta', async () => {
      const r = await svc.procesar(TENANT, { ...FIN, event: 'NOTIFY_END', pbx_call_id: 'fantasma' });

      expect(r.cuerpo).toEqual({ ok: true });
      expect(r.resumen).toContain('fantasma');
    });
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
