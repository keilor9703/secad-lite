import { ProveedorZadarma, fechaIso } from './zadarma.proveedor';
import { camposSecretos, faltanRequeridas, puede } from './proveedor';
import { firmar } from '../zadarma/zadarma.firma';

/**
 * El traductor de Zadarma.
 *
 * Es una función pura: del idioma de la central al modelo de FALCON. Lo que se
 * protege es que una llamada de verdad —que llega en cuatro avisos y no en
 * uno— signifique UNA llamada, y que lo que no es una entrante no se cuele en
 * la cola del 123.
 *
 * Qué se HACE con la traducción es otro archivo (`avisos.service.spec.ts`):
 * aquí no hay base, ni cola, ni dobles.
 */
describe('ProveedorZadarma · traducir', () => {
  const z = new ProveedorZadarma();

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

  it('la llamada entra a la cola apenas timbra, sin esperar destino', () => {
    // Es lo que distingue un CAD de un registro: el operador ve el número
    // mientras suena, no cuando ya contestó.
    const t = z.traducir(LLAMADA.inicio);

    expect(t.accion).toBe('entrante');
    if (t.accion !== 'entrante') return;
    expect(t.llamada.numero).toBe('573001234567');
    expect(t.llamada.callId).toBe('in-abc123');
    expect(t.llamada.extension).toBeUndefined();
  });

  it('cuando la central decide la extensión, es la MISMA llamada', () => {
    const t = z.traducir(LLAMADA.ofrecida);

    expect(t.accion).toBe('entrante');
    if (t.accion !== 'entrante') return;
    // El mismo callId: quien lo aplica lo reconoce y no duplica la fila.
    expect(t.llamada.callId).toBe('in-abc123');
    expect(t.llamada.extension).toBe('101');
  });

  it('contestar NO la marca como atendida en FALCON', () => {
    // «Atendida» significa que alguien la tomó desde la aplicación y se le
    // abrió el caso. Mientras se conteste por un softphone ajeno son dos cosas
    // distintas, y fingir que son una dejaría casos vacíos en el tablero.
    const t = z.traducir(LLAMADA.contestada);

    expect(t.accion).toBe('entrante');
    if (t.accion !== 'entrante') return;
    expect(t.llamada.agente).toBe('101');
  });

  describe('una llamada contestada por softphone no es una llamada perdida', () => {
    // «Llamadas perdidas del 123» es una cifra que el municipio reporta. Si un
    // operador descuelga en MicroSIP y atiende al ciudadano sin tocar FALCON,
    // esa llamada NO puede acabar contada como perdida.
    it('la central dice answered → se avisa que la atendieron por fuera', () => {
      const t = z.traducir(LLAMADA.colgada);
      expect(t.accion).toBe('cerrar');
      if (t.accion !== 'cerrar') return;
      expect(t.llamada.atendidaEnPlanta).toBe(true);
      expect(t.detalle).toContain('answered');
      expect(t.detalle).toContain('94');
    });

    it('sin contestar, ocupado o cancelada, sigue siendo perdida', () => {
      for (const d of ['no answer', 'busy', 'cancel', '']) {
        const t = z.traducir({ ...LLAMADA.colgada, disposition: d });
        expect(t.accion).toBe('cerrar');
        if (t.accion !== 'cerrar') return;
        expect(t.llamada.atendidaEnPlanta).toBe(false);
      }
    });
  });

  /**
   * EL FIN DE LA LLAMADA NO TIENE UN SOLO NOMBRE.
   *
   * Lo encontró la primera llamada real entre dos extensiones: entró a la cola
   * por `NOTIFY_INTERNAL` y al colgar NO se cerró en FALCON —siguió timbrando
   * y hubo que cerrarla a mano por la API—, porque desde la extensión que
   * marcó ese fin es una SALIENTE y llega como `NOTIFY_OUT_END`.
   */
  describe('cualquier aviso de fin cierra', () => {
    for (const evento of ['NOTIFY_END', 'NOTIFY_INTERNAL_END', 'NOTIFY_OUT_END']) {
      it(evento, () => {
        const t = z.traducir({ ...LLAMADA.colgada, event: evento });
        expect(t.accion).toBe('cerrar');
        if (t.accion !== 'cerrar') return;
        expect(t.llamada.callId).toBe('in-abc123');
      });
    }

    it('y el de una saliente se marca como tal, para poder decirlo distinto', () => {
      const t = z.traducir({ ...LLAMADA.colgada, event: 'NOTIFY_OUT_END' });
      expect(t.accion).toBe('cerrar');
      if (t.accion !== 'cerrar') return;
      expect(t.esSaliente).toBe(true);
    });

    it('en un fin de saliente NO se toma `internal` por el agente', () => {
      // Ahí `internal` es la extensión que MARCÓ, no la que contestó: en la
      // primera prueba real la llamada 101→102 quedó atribuida a la 101.
      const t = z.traducir({ ...LLAMADA.colgada, event: 'NOTIFY_OUT_END' });
      expect(t.accion).toBe('cerrar');
      if (t.accion !== 'cerrar') return;
      expect(t.llamada.agente).toBeUndefined();
    });
  });

  it('una llamada SALIENTE que empieza no entra a la cola', () => {
    // La cola de un CAD es de lo que entra. Meter ahí lo que marca un operador
    // la vuelve inútil en el primer turno.
    const t = z.traducir({
      event: 'NOTIFY_OUT_START', internal: '101', destination: '573009999999',
      call_start: '2026-10-15 10:00:00', pbx_call_id: 'out-1',
    });

    expect(t.accion).toBe('nada');
    if (t.accion !== 'nada') return;
    expect(t.resumen).toContain('no entra a la cola');
  });

  it('un evento que no sabemos traducir no revienta: queda anotado', () => {
    // La central reintenta lo que no recibe un 200, y un reintento infinito de
    // un evento que no nos interesa no arregla nada.
    const t = z.traducir({ event: 'SPEECH_RECOGNITION', pbx_call_id: 'x' });
    expect(t.accion).toBe('nada');
  });

  it('la hora de la central viaja como ISO, y una basura no tumba la llamada', () => {
    const bueno = z.traducir(LLAMADA.inicio);
    const malo = z.traducir({ ...LLAMADA.inicio, call_start: 'ayer por la tarde' });

    expect(bueno.accion === 'entrante' && bueno.llamada.fechaHora).toBe('2026-10-15T09:12:33');
    expect(malo.accion === 'entrante' && malo.llamada.fechaHora).toBeUndefined();
    expect(malo.accion === 'entrante' && malo.llamada.numero).toBe('573001234567');
  });
});

describe('ProveedorZadarma · verificar', () => {
  const z = new ProveedorZadarma();
  const cuerpo = { event: 'NOTIFY_START', caller_id: '300', called_did: '601', call_start: 'ya' };

  it('acepta la firma calculada con el secreto de esa instancia', () => {
    const firma = firmar('300601ya', 'secreto-bueno');
    expect(z.verificar(cuerpo, firma, { secreto: 'secreto-bueno' })).toEqual({ ok: true });
  });

  it('rechaza la firma de otro secreto', () => {
    const firma = firmar('300601ya', 'secreto-de-otro');
    expect(z.verificar(cuerpo, firma, { secreto: 'secreto-bueno' }).ok).toBe(false);
  });

  it('sin credencial no verifica nada, y lo dice', () => {
    const r = z.verificar(cuerpo, 'cualquiera', {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('secreto');
  });
});

describe('ProveedorZadarma · su ficha', () => {
  const z = new ProveedorZadarma();

  it('declara lo que FALCON sabe hacer con él, no lo que él sabría hacer', () => {
    // `grabacion` no está: Zadarma graba, pero FALCON todavía no la trae al
    // caso. Declararla haría que la pantalla ofreciera algo que no existe.
    expect(puede(z.descriptor, 'entrantes')).toBe(true);
    expect(puede(z.descriptor, 'grabacion')).toBe(false);
  });

  it('el secreto está marcado como secreto, que es lo que dispara el cifrado', () => {
    expect(camposSecretos(z.descriptor)).toEqual(['secreto']);
  });

  it('dice qué le falta con la etiqueta que lee el humano', () => {
    expect(faltanRequeridas(z.descriptor, {})).toEqual(['Key de la API', 'Secret de la API']);
    expect(faltanRequeridas(z.descriptor, { key: 'k', secreto: 's' })).toEqual([]);
  });

  it('y dónde se pega la dirección del webhook, en el idioma de SU panel', () => {
    expect(z.descriptor.rutaAviso).toBe('/api/pbx/zadarma/');
    expect(z.descriptor.dondeSePega).toContain('Notificaciones de eventos');
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
