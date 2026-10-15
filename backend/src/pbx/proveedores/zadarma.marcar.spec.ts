import { ProveedorZadarma } from './zadarma.proveedor';
import { cadenaParametros, firmarPeticion } from '../zadarma/zadarma.api';
import { puede } from './proveedor';

/**
 * Pedirle a Zadarma que origine una llamada.
 *
 * No es FALCON llamando al ciudadano: la central llama primero a la extensión
 * del operador y, cuando descuelga, al ciudadano. Lo que se protege aquí es la
 * petición exacta —la firma es imposible de depurar desde fuera: si no cuadra,
 * el servidor responde «authentication failed» y no dice en qué— y, sobre
 * todo, que **ninguna forma de fallar reviente**: un botón de llamar que lanza
 * un error de red en pantalla no sirve en una sala de despacho.
 */
describe('ProveedorZadarma · marcar', () => {
  const CRED = { key: 'a1b2c3d4e5f6a7b8c9d0', secreto: 'b1c2d3e4f5a6b7c8d9e0' };
  let pedidas: Array<{ url: string; headers: Record<string, string> }>;

  /** Un `fetch` de mentira que anota la petición y devuelve lo que se le diga. */
  function conRespuesta(estado: number, cuerpo: unknown, fallo?: Error) {
    pedidas = [];
    const falso = (async (url: string, init?: RequestInit) => {
      pedidas.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      if (fallo) throw fallo;
      return {
        ok: estado >= 200 && estado < 300,
        status: estado,
        json: async () => cuerpo,
      } as Response;
    }) as unknown as typeof fetch;
    return new ProveedorZadarma(falso, 'https://api.zadarma.com');
  }

  it('declara que sabe marcar, que es lo que habilita el botón', () => {
    expect(puede(conRespuesta(200, {}).descriptor, 'marcar')).toBe(true);
  });

  describe('la petición', () => {
    it('va al método de callback, con la extensión del operador y el número', async () => {
      const z = conRespuesta(200, { status: 'success', id: '42' });

      const r = await z.marcar(CRED, { extension: '101', numero: '573001234567' });

      expect(r).toEqual({ ok: true, id: '42' });
      expect(pedidas[0].url).toContain('/v1/request/callback/');
      // `from` es a quién llama primero la central: la extensión del operador.
      expect(pedidas[0].url).toContain('from=101');
      expect(pedidas[0].url).toContain('to=573001234567');
      expect(pedidas[0].url).toContain('sip=101');
    });

    it('va firmada con la llave de ESA instancia, en el encabezado que espera Zadarma', async () => {
      const z = conRespuesta(200, { status: 'success' });

      await z.marcar(CRED, { extension: '101', numero: '573001234567' });

      const cadena = cadenaParametros({ from: '101', to: '573001234567', sip: '101' });
      const esperada = firmarPeticion('/v1/request/callback/', cadena, CRED.secreto);
      expect(pedidas[0].headers.Authorization).toBe(`${CRED.key}:${esperada}`);
    });

    it('los parámetros de la URL son EXACTAMENTE los que se firmaron', async () => {
      // Si la cadena firmada y la enviada difieren en una coma, Zadarma
      // rechaza y no dice por qué. Es el error más difícil de ver.
      const z = conRespuesta(200, { status: 'success' });

      await z.marcar(CRED, { extension: '101', numero: '+573001234567' });

      const cadena = cadenaParametros({ from: '101', to: '+573001234567', sip: '101' });
      expect(pedidas[0].url).toBe(`https://api.zadarma.com/v1/request/callback/?${cadena}`);
    });
  });

  it('la base de la API se puede apuntar a un proxy de salida', async () => {
    // El webhook y la API van en direcciones contrarias: un servidor con el
    // egreso restringido recibe llamadas perfectamente y no puede originar
    // ninguna. Con esto se sale por un proxy sin tocar código.
    pedidas = [];
    const z = new ProveedorZadarma((async (url: string) => {
      pedidas.push({ url: String(url), headers: {} });
      return { ok: true, status: 200, json: async () => ({ status: 'success' }) } as Response;
    }) as unknown as typeof fetch, 'https://salida.interna:8443');

    await z.marcar(CRED, { extension: '101', numero: '300300' });

    expect(pedidas[0].url.startsWith('https://salida.interna:8443/v1/request/callback/')).toBe(true);
  });

  describe('ninguna forma de fallar revienta', () => {
    it('sin credenciales, lo dice en vez de llamar a ciegas', async () => {
      const z = conRespuesta(200, {});
      const r = await z.marcar({}, { extension: '101', numero: '573001234567' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('credenciales');
      expect(pedidas).toEqual([]);
    });

    it('un 401 con credenciales mal pegadas señala CUÁL es la sospechosa', async () => {
      // Un espacio al copiar da el mismo «authentication failed» que una
      // credencial equivocada; sin esta pista hay que adivinar cuál de las dos.
      const z = conRespuesta(401, { status: 'error', message: 'authentication failed' });

      const r = await z.marcar({ key: 'corta', secreto: CRED.secreto }, { extension: '101', numero: '300300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('la Key');
      expect(r.error).not.toContain('el Secret');
    });

    it('y si las dos tienen buena forma, dice que serán de otra cuenta', async () => {
      const z = conRespuesta(401, { status: 'error', message: 'authentication failed' });

      const r = await z.marcar(CRED, { extension: '101', numero: '300300' });

      expect(r.error).toContain('otra cuenta');
    });

    it('un error de negocio de Zadarma se repite tal cual: es lo que hay que leer', async () => {
      const z = conRespuesta(200, { status: 'error', message: 'Not enough money on the balance' });

      const r = await z.marcar(CRED, { extension: '101', numero: '300300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('Not enough money');
    });

    it('una respuesta que no es JSON no tumba el botón', async () => {
      const z = new ProveedorZadarma((async () => ({
        ok: false, status: 502, json: async () => { throw new Error('no es JSON'); },
      })) as unknown as typeof fetch, 'https://api.zadarma.com');

      const r = await z.marcar(CRED, { extension: '101', numero: '300300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('502');
    });

    it('la central caída devuelve un motivo, no una excepción', async () => {
      const z = conRespuesta(0, {}, new Error('getaddrinfo ENOTFOUND'));

      const r = await z.marcar(CRED, { extension: '101', numero: '300300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('ENOTFOUND');
    });

    it('y si no responde a tiempo, lo dice así', async () => {
      const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      const z = conRespuesta(0, {}, timeout);

      const r = await z.marcar(CRED, { extension: '101', numero: '300300' });

      expect(r.error).toContain('no respondió a tiempo');
    });
  });
});
