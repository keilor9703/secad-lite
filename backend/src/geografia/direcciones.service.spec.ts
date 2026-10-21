import { DireccionesService } from './direcciones.service';

/**
 * El parser es la pieza que decide si una dirección se resuelve por esquina
 * —precisa— o cae a la búsqueda por texto libre, que es la que mandaba el
 * punto a 4,75 km. Se prueba sin red: solo el análisis del texto.
 */
describe('DireccionesService — nomenclatura colombiana', () => {
  const svc = new DireccionesService();

  it('desarma la dirección del caso reportado', () => {
    expect(svc.parsear('Calle 53 # 52-35, Bogotá D.C.')).toEqual({
      viaTipo: 'calle', viaNumero: '53', cruceNumero: '52', placa: 35,
    });
  });

  it('acepta las abreviaturas que se usan a diario', () => {
    const esperado = { viaTipo: 'carrera', viaNumero: '7', cruceNumero: '45', placa: 12 };
    for (const t of ['Cra 7 No 45-12', 'CRA 7 No. 45-12', 'Kr 7 #45-12', 'carrera 7 nro 45-12']) {
      expect(svc.parsear(t)).toEqual(esperado);
    }
  });

  it('no confunde la «N» de «No» con la letra de la vía', () => {
    // Con el patrón anterior esto se leía «Carrera 7 N» y perdía cruce y placa,
    // así que la dirección terminaba resolviéndose por texto libre.
    const d = svc.parsear('Cra 7 No 45-12');
    expect(d?.viaNumero).toBe('7');
    expect(d?.cruceNumero).toBe('45');
  });

  it('conserva los sufijos de la vía', () => {
    expect(svc.parsear('Diagonal 40A # 18-30')?.viaNumero).toBe('40a');
    expect(svc.parsear('carrera 15 bis # 100-20')?.viaNumero).toBe('15 bis');
    expect(svc.parsear('Tv 39 # 5-90 Sur')?.viaTipo).toBe('transversal');
  });

  it('entiende los tipos compuestos', () => {
    expect(svc.parsear('Av Calle 26 # 68-35')?.viaTipo).toBe('avenida calle');
    expect(svc.parsear('Avenida Carrera 30 # 45-03')?.viaTipo).toBe('avenida carrera');
    // El «av» suelto no debe comerse el tipo que viene detrás.
    expect(svc.parsear('Av 68 # 24-30')?.viaTipo).toBe('avenida');
  });

  it('acepta una vía sin cruce ni placa', () => {
    expect(svc.parsear('Calle 53')).toEqual({
      viaTipo: 'calle', viaNumero: '53', cruceNumero: undefined, placa: undefined,
    });
  });

  it('devuelve null cuando el texto no es una dirección', () => {
    for (const t of ['', '   ', 'Parque Simón Bolívar', 'frente al colegio']) {
      expect(svc.parsear(t)).toBeNull();
    }
  });
});

/**
 * `porInterseccion` probaba los candidatos de cruce uno por uno, en cascada
 * (hasta 25s cada intento fallido) — la causa principal de las búsquedas de
 * "hasta un minuto" reportadas. Ahora se prueban en paralelo. Estas pruebas
 * simulan Overpass con un `fetch` controlado a mano para verificar que el
 * cambio dispara ambas llamadas de una vez y que, aun así, sigue ganando el
 * candidato de mayor prioridad — no el que responda primero.
 */
describe('DireccionesService — candidatos de cruce en paralelo (red simulada)', () => {
  const svc = new DireccionesService();
  const fetchOriginal = global.fetch;
  let resolvers: Record<string, (elements: unknown[]) => void>;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    resolvers = {};
    fetchMock = jest.fn((_url: string, opts: { body: URLSearchParams }) => {
      const data = opts.body.get('data') ?? '';
      // «Diagonal 40 # 18»: los candidatos de COMPLEMENTO.diagonal son
      // ['transversal', 'carrera'] — sus patrones de vía no se solapan, así
      // que basta con mirar cuál aparece en la consulta para saber cuál es.
      const clave = data.includes('Transversal|Tv') ? 'transversal' : 'carrera';
      return new Promise((resolve) => {
        resolvers[clave] = (elements) => resolve({ ok: true, json: async () => ({ elements }) });
      });
    }) as unknown as jest.Mock;
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = fetchOriginal;
  });

  it('dispara los dos candidatos a la vez, no uno tras otro', () => {
    const d = svc.parsear('Diagonal 40 # 18')!;
    void (svc as unknown as { porInterseccion: Function }).porInterseccion(d, {
      nombre: 'Test', lat: 4.6, lng: -74.1,
    });
    // Si siguiera siendo secuencial, en este punto solo se habría llamado una
    // vez a fetch (el segundo candidato solo se dispara si el primero falla).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolvers.transversal([]);
    resolvers.carrera([]);
  });

  it('conserva la prioridad de la lista aunque el candidato de menor prioridad responda primero', async () => {
    const d = svc.parsear('Diagonal 40 # 18')!;
    const p = (svc as unknown as { porInterseccion: Function }).porInterseccion(d, {
      nombre: 'Test', lat: 4.6, lng: -74.1,
    });
    // "carrera" (segunda opción de COMPLEMENTO.diagonal) responde primero...
    resolvers.carrera([{ lat: 1, lon: 1 }]);
    // ...pero "transversal" (primera opción) también resuelve, y debe ganar.
    resolvers.transversal([{ lat: 2, lon: 2 }]);
    const resultado = await p;
    expect(resultado).toEqual({ lat: 2, lng: 2, precision: 'esquina', etiqueta: 'Diagonal 40 # 18' });
  });
});

/**
 * GOOGLE COMO TERCER INTENTO, NO COMO PRIMERO.
 *
 * Google es el proveedor contratado y el que mejor conoce la nomenclatura
 * urbana colombiana, así que entra en la cadena. Pero va DESPUÉS del cruce
 * por Overpass y no antes: Overpass consulta el grafo real de calles y
 * devuelve el portal con los metros de la placa, mientras que Google no
 * resuelve intersecciones arbitrarias. Ponerlo delante cambiaría un punto
 * exacto por uno aproximado.
 */
describe('DireccionesService — Google en la cadena de geocodificación', () => {
  const fetchOriginal = global.fetch;
  let svc: DireccionesService;
  /** Cada URL que se pidió, en orden. */
  let pedidas: string[];
  /** Lo que contesta Google. */
  let respuestaGoogle: unknown;

  const ITAGUI = {
    nombre: 'Itagüí', lat: 6.1845, lng: -75.5986,
    bbox: [6.14, 6.22, -75.64, -75.56] as [number, number, number, number],
  };

  beforeEach(() => {
    svc = new DireccionesService();
    pedidas = [];
    respuestaGoogle = {
      status: 'OK',
      results: [{
        formatted_address: 'Cra. 51 #51-55, Itagüí, Antioquia',
        geometry: { location: { lat: 6.1702, lng: -75.6111 }, location_type: 'ROOFTOP' },
      }],
    };
    process.env['GOOGLE_GEOCODING_API_KEY'] = 'clave-de-prueba';

    (global as unknown as { fetch: typeof fetch }).fetch = ((url: string) => {
      pedidas.push(String(url));
      if (String(url).includes('maps.googleapis.com')) {
        return Promise.resolve({ ok: true, json: async () => respuestaGoogle });
      }
      // Nominatim: sin resultados, para que se vea quién contesta de verdad.
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = fetchOriginal;
    delete process.env['GOOGLE_GEOCODING_API_KEY'];
  });

  const porGoogle = (texto: string, lugar: unknown = ITAGUI) =>
    (svc as unknown as { porGoogle: Function }).porGoogle(texto, lugar);

  it('resuelve la dirección y la marca como placa cuando es el portal exacto', async () => {
    const p = await porGoogle('Carrera 51 # 51-55');

    expect(p.lat).toBe(6.1702);
    expect(p.precision).toBe('placa');
    expect(p.etiqueta).toContain('Itagüí');
  });

  it('lo interpolado o centrado en la vía NO es una placa', async () => {
    // El despachador tiene que poder distinguir el portal exacto de un punto
    // sobre la vía antes de mandar a alguien a una dirección.
    (respuestaGoogle as { results: Array<{ geometry: { location_type: string } }> })
      .results[0].geometry.location_type = 'RANGE_INTERPOLATED';

    expect((await porGoogle('Carrera 51 # 51-55')).precision).toBe('aproximada');
  });

  it('un resultado FUERA del municipio se descarta', async () => {
    // `bounds` en la API de Google es un SESGO, no un filtro: una «Calle 53»
    // de otra ciudad puede ganar igual. Despachar una patrulla al municipio
    // vecino porque el nombre de la calle coincidía es lo que esto evita.
    (respuestaGoogle as { results: Array<{ geometry: { location: { lat: number; lng: number } } }> })
      .results[0].geometry.location = { lat: 4.65, lng: -74.05 }; // Bogotá

    expect(await porGoogle('Calle 53')).toBeNull();
  });

  it('se restringe a Colombia y se sesga al municipio', async () => {
    await porGoogle('Carrera 51 # 51-55');
    const url = pedidas.find((u) => u.includes('maps.googleapis.com'))!;

    expect(url).toContain('components=country:CO');
    expect(url).toContain('bounds=6.14,-75.64|6.22,-75.56');
  });

  it('sin clave configurada no se llama a Google', async () => {
    delete process.env['GOOGLE_GEOCODING_API_KEY'];
    delete process.env['GOOGLE_MAPS_API_KEY'];

    expect(await porGoogle('Carrera 51 # 51-55')).toBeNull();
    expect(pedidas.filter((u) => u.includes('maps.googleapis.com')).length).toBe(0);
  });

  it('un rechazo de Google no rompe nada: se devuelve nulo y sigue la cadena', async () => {
    // `REQUEST_DENIED` casi siempre es la restricción de la clave: la del
    // navegador va por referente HTTP y desde el servidor no hay referente.
    //
    // Se manda un resultado JUNTO al rechazo a propósito: la garantía no es
    // «sin resultados no hay punto» —eso pasaría solo—, es que un `status`
    // que no sea OK NO se da por bueno aunque venga algo dentro.
    respuestaGoogle = {
      status: 'REQUEST_DENIED',
      error_message: 'API keys with referer restrictions cannot be used with this API',
      results: [{
        formatted_address: 'algo',
        geometry: { location: { lat: 6.17, lng: -75.61 }, location_type: 'ROOFTOP' },
      }],
    };

    expect(await porGoogle('Carrera 51 # 51-55')).toBeNull();
  });

  it('el CRUCE sigue mandando: Google no se consulta si Overpass resolvió', async () => {
    // Es la garantía que ordena toda la cadena. Si Google se adelantara, un
    // «calle 50 con carrera 70» pasaría de portal exacto a punto aproximado.
    const svc2 = new DireccionesService();
    const interno = svc2 as unknown as { porInterseccion: (...a: unknown[]) => unknown };
    const porInterseccion = jest.fn().mockResolvedValue(
      { lat: 6.17, lng: -75.61, precision: 'placa', etiqueta: 'cruce' },
    );
    interno.porInterseccion = porInterseccion;

    // Una dirección que el parseador reconoce como cruce con placa.
    const r = await svc2.geocodificar('Calle 50 # 70-20', ITAGUI as never);

    expect(porInterseccion).toHaveBeenCalled();
    expect(r!.precision).toBe('placa');
    expect(pedidas.filter((u) => u.includes('maps.googleapis.com')).length).toBe(0);
  });
});
