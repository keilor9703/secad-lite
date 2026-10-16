import { ProveedorZadarma, esExtensionInterna, fechaIso } from './zadarma.proveedor';
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

  /**
   * LA MISMA ASIMETRÍA QUE EL FIN, AHORA EN EL COMIENZO.
   *
   * El caso real (demo, 16/10/2026): llamando 102 → 100 la central NO mandó
   * `NOTIFY_INTERNAL`. Mandó `NOTIFY_OUT_START` —desde la 102 es una
   * saliente— y mientras eso decía «nada», la fila de la cola la creaba
   * `NOTIFY_ANSWER`, que llega CUANDO YA SE CONTESTÓ. Al contestar dentro de
   * FALCON no había nada con qué emparejar: en `pbx_webhook_log`, OUT_START a
   * las 11:55:06 y ANSWER a las 11:55:11.
   */
  describe('una llamada entre extensiones empieza como SALIENTE y entra a la cola', () => {
    const INTERNA = {
      event: 'NOTIFY_OUT_START', internal: '102', destination: '100',
      caller_id: '102', call_start: '2026-10-16 11:55:06', pbx_call_id: 'in-102-100',
    };

    it('entra a la cola, no se ignora', () => {
      const t = z.traducir(INTERNA);
      expect(t.accion).toBe('entrante');
    });

    it('dirigida a quien RECIBE, no a quien marcó', () => {
      // `internal` es la extensión que marcó. Tomarla por destinataria dejaba
      // la llamada dirigida a quien la originó: la 100 nunca se enteraba.
      const t = z.traducir(INTERNA);
      expect(t.accion).toBe('entrante');
      if (t.accion !== 'entrante') return;
      expect(t.llamada.extension).toBe('100');
      expect(t.llamada.numero).toBe('102');
      expect(t.llamada.callId).toBe('in-102-100');
    });

    it('un destino que SÍ es un abonado sigue sin entrar', () => {
      // Esto es lo que protege la cola: la saliente de un operador hacia un
      // ciudadano no es una llamada entrante de nadie.
      for (const destino of ['573009999999', '5730099999', '3009999999']) {
        const t = z.traducir({ ...INTERNA, destination: destino });
        // El destino va en la aserción para que un fallo diga CUÁL falló.
        expect({ destino, accion: t.accion }).toEqual({ destino, accion: 'nada' });
      }
    });

    it('sin destino, o con un destino que no es un número, tampoco', () => {
      // No se sabe qué es. Meter en la cola lo que no se entiende es peor que
      // anotarlo y seguir.
      for (const destino of [undefined, '', '  ', 'sip:algo@dominio']) {
        const t = z.traducir({ ...INTERNA, destination: destino });
        expect({ destino, accion: t.accion }).toEqual({ destino, accion: 'nada' });
      }
    });
  });

  describe('esExtensionInterna', () => {
    it('una extensión de la centralita sí', () => {
      for (const d of ['100', '102', '1', '12', '99999', '108']) {
        expect({ d, interna: esExtensionInterna(d) }).toEqual({ d, interna: true });
      }
    });

    it('un abonado no — misma frontera que esNumeroMarcable: 7 dígitos', () => {
      for (const d of ['1234567', '573001234567', '3001234000']) {
        expect({ d, interna: esExtensionInterna(d) }).toEqual({ d, interna: false });
      }
      // Justo por debajo del piso sigue siendo extensión.
      expect(esExtensionInterna('123456')).toBe(true);
    });

    it('lo que no es un número, no', () => {
      for (const d of [undefined, '', '  ', '+CO.4552575428314811', 'anonymous', '10a']) {
        expect({ d, interna: esExtensionInterna(d) }).toEqual({ d, interna: false });
      }
    });
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

/**
 * La configuración con la que el navegador se registra como teléfono.
 *
 * Lo que se protege es el error que estuvo a punto de desplegarse: **el
 * usuario SIP de la extensión 101 no es «101»**. En Zadarma es
 * «598703-101» —cuenta de la centralita, guión, extensión—, y registrarse
 * como «101» a secas falla con un rechazo genérico del servidor SIP que no
 * dice que el usuario esté mal compuesto. Lo delató una captura del panel.
 */
describe('ProveedorZadarma · softphone', () => {
  const z = new ProveedorZadarma();
  const CRED = {
    key: 'k', secreto: 's', sipCuenta: '598703',
    sipWss: 'wss://ejemplo', sipDominio: 'pbx.zadarma.com',
  };

  it('compone el usuario SIP con la cuenta y la extensión', () => {
    expect(z.softphone(CRED, '101', 'clave')).toEqual({
      wss: 'wss://ejemplo',
      dominio: 'pbx.zadarma.com',
      usuario: '598703-101',
      extension: '101',
      clave: 'clave',
    });
  });

  it('y NO usa la extensión sola, que es lo que nunca se registraría', () => {
    expect(z.softphone(CRED, '101', 'clave')?.usuario).not.toBe('101');
  });

  describe('media configuración no sirve: devuelve null', () => {
    for (const falta of ['sipCuenta', 'sipWss', 'sipDominio'] as const) {
      it(`sin ${falta}`, () => {
        expect(z.softphone({ ...CRED, [falta]: '' }, '101', 'clave')).toBeNull();
      });
    }

    it('sin extensión', () => {
      expect(z.softphone(CRED, '', 'clave')).toBeNull();
    });

    it('sin clave SIP', () => {
      expect(z.softphone(CRED, '101', '')).toBeNull();
    });
  });

  it('la cuenta no es un campo requerido: sin softphone la telefonía funciona igual', () => {
    // Exigirla dejaría sin encender la planta a quien solo quiere que entren
    // llamadas a la cola, que es como opera todo el mundo hoy.
    const cuenta = z.descriptor.credenciales.find((c) => c.clave === 'sipCuenta');
    expect(cuenta?.requerido).toBe(false);
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
