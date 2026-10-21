import {
  CanalEnlace, ORDEN_AUTOMATICO, canalesValidos, enviarPorElPrimeroQuePueda,
  parsearOrden, textoDeOrden,
} from './orden-envio';

/**
 * EL ORDEN DE SALIDA DEL ENLACE DE LA VIDEOLLAMADA.
 *
 * Lo que se protege aquí no es una preferencia: es que el ciudadano reciba el
 * enlace. Tres formas de perderlo, y las tres están probadas abajo:
 *
 *  1. Una configuración ilegible que deje la lista de caminos vacía.
 *  2. Un camino que lance una excepción y se lleve consigo los que faltaban
 *     por probar.
 *  3. Un orden guardado que el envío no respete.
 */
describe('parsearOrden · lo que se lee de la base', () => {
  it('respeta el orden elegido', () => {
    expect(parsearOrden('sms,whatsapp,plantilla')).toEqual(['sms', 'whatsapp', 'plantilla']);
    expect(parsearOrden('plantilla,whatsapp,sms')).toEqual(['plantilla', 'whatsapp', 'sms']);
  });

  it('admite un subconjunto: no todos quieren los tres caminos', () => {
    // Un municipio que no quiere pagar SMS lo deja fuera a conciencia.
    expect(parsearOrden('whatsapp,plantilla')).toEqual(['whatsapp', 'plantilla']);
    expect(parsearOrden('sms')).toEqual(['sms']);
  });

  it('tolera cómo esté escrito', () => {
    // La columna la puede haber tocado alguien por psql en una madrugada.
    expect(parsearOrden('SMS, Whatsapp')).toEqual(['sms', 'whatsapp']);
    expect(parsearOrden('sms whatsapp plantilla')).toEqual(['sms', 'whatsapp', 'plantilla']);
    expect(parsearOrden('  sms ,, whatsapp  ')).toEqual(['sms', 'whatsapp']);
  });

  it('colapsa repetidos y gana la primera aparición', () => {
    // Intentar dos veces el mismo camino solo retrasa el que sí iba a servir.
    expect(parsearOrden('sms,whatsapp,sms')).toEqual(['sms', 'whatsapp']);
  });

  describe('y cuando no se entiende, el automático', () => {
    it('sin configurar', () => {
      expect(parsearOrden(null)).toEqual([...ORDEN_AUTOMATICO]);
      expect(parsearOrden(undefined)).toEqual([...ORDEN_AUTOMATICO]);
      expect(parsearOrden('')).toEqual([...ORDEN_AUTOMATICO]);
    });

    it('con basura, o con nombres de otra versión', () => {
      // Esto es lo que impide que un valor raro en la columna deje al
      // ciudadano sin enlace por NINGÚN camino. Una lista vacía aquí sería
      // una avería silenciosa: el envío no fallaría, simplemente no pasaría.
      expect(parsearOrden('correo,telegram')).toEqual([...ORDEN_AUTOMATICO]);
      expect(parsearOrden('{"orden":[]}')).toEqual([...ORDEN_AUTOMATICO]);
      expect(parsearOrden(',,,')).toEqual([...ORDEN_AUTOMATICO]);
    });

    it('rescatando lo que sí reconoce', () => {
      expect(parsearOrden('telegram,sms,correo')).toEqual(['sms']);
    });
  });
});

describe('textoDeOrden · lo que se guarda', () => {
  it('un orden distinto del automático se guarda tal cual', () => {
    expect(textoDeOrden(['sms', 'whatsapp', 'plantilla'])).toBe('sms,whatsapp,plantilla');
  });

  it('elegir a mano el orden automático se guarda como «automático»', () => {
    // Guardar `whatsapp,plantilla,sms` congelaría la lógica de hoy: si mañana
    // se cambia el orden por defecto, esa instancia se quedaría con el viejo
    // sin que nadie lo hubiera decidido.
    expect(textoDeOrden([...ORDEN_AUTOMATICO])).toBeNull();
  });

  it('«que decida el sistema» es nulo', () => {
    expect(textoDeOrden(null)).toBeNull();
    expect(textoDeOrden(undefined)).toBeNull();
  });

  it('una lista sin nada reconocible también es nulo, no un orden vacío', () => {
    expect(textoDeOrden([])).toBeNull();
    expect(textoDeOrden(['telegram'])).toBeNull();
  });

  it('normaliza antes de guardar', () => {
    expect(textoDeOrden([' SMS ', 'Plantilla', 'sms'])).toBe('sms,plantilla');
  });
});

describe('canalesValidos · distinguir «vacío» de «es el automático»', () => {
  it('separa los dos casos que textoDeOrden ve iguales', () => {
    // Los dos devuelven null en textoDeOrden, y confundirlos rechazaba con un
    // 400 al administrador que eligiera a mano los tres caminos de siempre.
    expect(canalesValidos([...ORDEN_AUTOMATICO]).length).toBe(3);
    expect(canalesValidos(['telegram', 'correo']).length).toBe(0);
  });
});

describe('enviarPorElPrimeroQuePueda', () => {
  /** Qué caminos se intentaron, en qué orden. */
  let intentados: string[];
  /** Qué camino acepta el envío. Nulo = ninguno. */
  let elQueFunciona: CanalEnlace | null;
  /** Caminos que lanzan excepción en vez de contestar. */
  let revientan: Set<string>;

  const intentos = () => {
    const uno = (c: CanalEnlace) => async () => {
      intentados.push(c);
      if (revientan.has(c)) throw new Error(`${c} se cayó`);
      return elQueFunciona === c;
    };
    return { whatsapp: uno('whatsapp'), plantilla: uno('plantilla'), sms: uno('sms') };
  };

  beforeEach(() => {
    intentados = [];
    elQueFunciona = null;
    revientan = new Set();
  });

  it('prueba en el orden dado y para en el primero que funciona', async () => {
    elQueFunciona = 'whatsapp';

    const salio = await enviarPorElPrimeroQuePueda(['sms', 'whatsapp', 'plantilla'], intentos());

    expect(salio).toBe('whatsapp');
    // El SMS se intentó ANTES porque así estaba configurado, y la plantilla no
    // se intentó en absoluto: ya había salido.
    expect(intentados).toEqual(['sms', 'whatsapp']);
  });

  it('el orden inverso se respeta igual', async () => {
    elQueFunciona = 'sms';

    const salio = await enviarPorElPrimeroQuePueda(['plantilla', 'whatsapp', 'sms'], intentos());

    expect(salio).toBe('sms');
    expect(intentados).toEqual(['plantilla', 'whatsapp', 'sms']);
  });

  it('no intenta un camino que no está en el orden', async () => {
    // Un municipio que deja el SMS fuera no paga un SMS por accidente.
    elQueFunciona = 'sms';

    const salio = await enviarPorElPrimeroQuePueda(['whatsapp', 'plantilla'], intentos());

    expect(salio).toBeNull();
    expect(intentados).toEqual(['whatsapp', 'plantilla']);
  });

  it('la plantilla se nombra aparte, porque LLEGA DISTINTA', async () => {
    // Llega como un botón, no como un enlace suelto: el despachador tiene que
    // decirle al ciudadano que lo pulse, y para eso necesita saberlo.
    elQueFunciona = 'plantilla';

    expect(await enviarPorElPrimeroQuePueda(['plantilla'], intentos())).toBe('whatsapp-plantilla');
  });

  it('un camino que revienta NO se lleva los que faltaban', async () => {
    // Es el motivo de que esto sea un bucle con try y no una cadena de else
    // if: una excepción en el primer camino dejaba al ciudadano sin enlace
    // teniendo el SMS disponible.
    revientan.add('whatsapp');
    elQueFunciona = 'sms';
    const fallos: string[] = [];

    const salio = await enviarPorElPrimeroQuePueda(
      ['whatsapp', 'plantilla', 'sms'], intentos(), (c) => fallos.push(c));

    expect(salio).toBe('sms');
    expect(intentados).toEqual(['whatsapp', 'plantilla', 'sms']);
    // Y queda anotado, que es lo que permite diagnosticarlo después.
    expect(fallos).toEqual(['whatsapp']);
  });

  it('si todos revientan, se devuelve «no salió» en vez de lanzar', async () => {
    // La videollamada queda abierta igual: el despachador puede dictar el
    // enlace por teléfono. Lanzar aquí le quitaría también esa salida.
    revientan = new Set(['whatsapp', 'plantilla', 'sms']);

    await expect(enviarPorElPrimeroQuePueda([...ORDEN_AUTOMATICO], intentos()))
      .resolves.toBeNull();
  });

  it('si ninguno puede, se devuelve «no salió»', async () => {
    elQueFunciona = null;

    expect(await enviarPorElPrimeroQuePueda([...ORDEN_AUTOMATICO], intentos())).toBeNull();
    expect(intentados).toEqual(['whatsapp', 'plantilla', 'sms']);
  });
});
