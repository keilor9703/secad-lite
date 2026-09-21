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
