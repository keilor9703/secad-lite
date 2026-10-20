import { ProveedorAsterisk } from './asterisk.proveedor';
import { ProveedorPbx, puede, camposSecretos, faltanRequeridas } from './proveedor';

const CRED = {
  wss: 'wss://centralita.ejemplo.com:8089/ws',
  dominio: 'centralita.ejemplo.com',
  ariUrl: 'https://centralita.ejemplo.com:8089/ari',
  ariUsuario: 'falcon',
  ariClave: 's3cr3t0',
};

/** Un `fetch` de mentira: guarda lo que se le pidió y contesta lo que se le diga. */
function fetchFalso(respuesta: Partial<Response> & { cuerpo?: unknown } = {}) {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return {
      ok: respuesta.ok ?? true,
      status: respuesta.status ?? 200,
      json: async () => respuesta.cuerpo ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

/**
 * LA CENTRALITA PROPIA.
 *
 * Lo que se prueba aquí no es Asterisk —eso se prueba con una llamada— sino
 * las decisiones de FALCON: qué se le entrega al navegador, en qué orden se
 * origina una llamada, y que un fallo diga a quién llamar en vez de un número.
 */
describe('ProveedorAsterisk', () => {
  const z = new ProveedorAsterisk();

  describe('la ficha', () => {
    it('sabe las tres cosas: recibir, marcar y contestar en el navegador', () => {
      expect(puede(z.descriptor, 'entrantes')).toBe(true);
      expect(puede(z.descriptor, 'marcar')).toBe(true);
      expect(puede(z.descriptor, 'softphone')).toBe(true);
    });

    it('NO traduce eventos: entra por el webhook genérico, como YACO', () => {
      // No es una omisión. La centralita es nuestra, así que el dialplan
      // habla el modelo de FALCON desde el principio en vez de que FALCON
      // adivine el idioma de una central ajena.
      const puerto = z as ProveedorPbx;
      expect(puerto.traducir).toBeUndefined();
      expect(puerto.verificar).toBeUndefined();
      expect(z.descriptor.rutaAviso).toBe('/api/pbx/webhook');
    });

    it('solo la clave de ARI es secreta', () => {
      expect(camposSecretos(z.descriptor)).toEqual(['ariClave']);
    });

    it('sin la dirección wss ni el dominio, la planta no se deja encender', () => {
      // Devuelve las ETIQUETAS, que es lo que lee el superadmin en pantalla,
      // no las claves internas.
      expect(faltanRequeridas(z.descriptor, {})).toEqual([
        'WebSocket SIP (wss://)', 'Dominio SIP',
      ]);
      // Lo de ARI es opcional: sin eso, entrantes y softphone funcionan igual.
      expect(faltanRequeridas(z.descriptor, { wss: 'w', dominio: 'd' })).toEqual([]);
    });
  });

  describe('softphone', () => {
    it('el usuario SIP ES la extensión, sin prefijo de cuenta', () => {
      // En Zadarma la 101 se registra como «598703-101». Ese prefijo era una
      // particularidad suya, no de SIP: copiarlo aquí dejaría el registro
      // fallando con un rechazo genérico imposible de interpretar.
      const c = z.softphone!(CRED, '101', 'clave-sip');

      expect(c).toEqual({
        wss: CRED.wss,
        dominio: CRED.dominio,
        usuario: '101',
        extension: '101',
        clave: 'clave-sip',
      });
    });

    it('si falta cualquier pieza devuelve null, no una configuración a medias', () => {
      // Una dirección vacía da un error de WebSocket que no se parece en nada
      // a «esto nunca se configuró».
      expect(z.softphone!({ ...CRED, wss: '' }, '101', 'c')).toBeNull();
      expect(z.softphone!({ ...CRED, dominio: '  ' }, '101', 'c')).toBeNull();
      expect(z.softphone!(CRED, '', 'c')).toBeNull();
      expect(z.softphone!(CRED, '101', '')).toBeNull();
    });
  });

  describe('marcar', () => {
    it('llama PRIMERO a la extensión del operador, no al ciudadano', async () => {
      // Si se llamara primero al ciudadano, contestaría a un silencio mientras
      // la central busca a un operador que puede no estar en su puesto.
      const { f, llamadas } = fetchFalso({ cuerpo: { id: 'canal-1' } });

      const r = await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '573001234567' });

      expect(r.ok).toBe(true);
      expect(r.id).toBe('canal-1');
      const u = new URL(llamadas[0].url);
      expect(u.searchParams.get('endpoint')).toBe('PJSIP/101');
      expect(u.searchParams.get('extension')).toBe('573001234567');
      expect(llamadas[0].init?.method).toBe('POST');
    });

    it('el canal del operador se identifica con SU PROPIA extensión', async () => {
      // No es cosmético: el navegador reconoce que ese INVITE es la saliente
      // que él mismo pidió —y no una emergencia— porque viene de su propia
      // extensión, y nadie más puede llamar desde ella. Ver `esMiSaliente`
      // en `softphone.service.ts`. Si esto cambia, la barra vuelve a ofrecer
      // «Entra una llamada · Rechazar» para la llamada del propio operador.
      const { f, llamadas } = fetchFalso();
      await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '+573001234567' });
      expect(new URL(llamadas[0].url).searchParams.get('callerId')).toBe('101');
    });

    it('sin contexto configurado usa «salientes», el de la plantilla', async () => {
      const { f, llamadas } = fetchFalso();
      await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });
      expect(new URL(llamadas[0].url).searchParams.get('context')).toBe('salientes');
    });

    it('y respeta el contexto que se configure', async () => {
      const { f, llamadas } = fetchFalso();
      await new ProveedorAsterisk(f).marcar!(
        { ...CRED, contextoSaliente: 'desde-falcon' }, { extension: '101', numero: '300' },
      );
      expect(new URL(llamadas[0].url).searchParams.get('context')).toBe('desde-falcon');
    });

    it('pone un tope al timbre del operador', async () => {
      // Sin tope, un operador que no está en su puesto deja un canal colgado
      // consumiendo un cupo de la troncal.
      const { f, llamadas } = fetchFalso();
      await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });
      expect(new URL(llamadas[0].url).searchParams.get('timeout')).toBe('30');
    });

    it('se autentica con Basic, no manda la clave en la URL', async () => {
      // Una clave en la URL queda en los registros de la centralita y en
      // cualquier proxy que haya en medio.
      const { f, llamadas } = fetchFalso();
      await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });

      const auth = (llamadas[0].init?.headers as Record<string, string>)?.Authorization;
      expect(auth).toBe(`Basic ${Buffer.from('falcon:s3cr3t0').toString('base64')}`);
      expect(llamadas[0].url).not.toContain('s3cr3t0');
    });

    it('sin ARI configurado NO intenta la llamada, y lo dice', async () => {
      const { f, llamadas } = fetchFalso();
      const r = await new ProveedorAsterisk(f).marcar!(
        { wss: 'w', dominio: 'd' }, { extension: '101', numero: '300' },
      );

      expect(r.ok).toBe(false);
      expect(r.error).toContain('ARI');
      expect(llamadas).toEqual([]);
    });

    it('un 401 dice qué revisar, no un número', async () => {
      // «401» no le sirve a un operador con un ciudadano al teléfono.
      const { f } = fetchFalso({ ok: false, status: 401 });
      const r = await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('ari.conf');
    });

    it('un 404 apunta a la extensión y al contexto', async () => {
      const { f } = fetchFalso({ ok: false, status: 404 });
      const r = await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });
      expect(r.error).toContain('contexto');
    });

    it('si la centralita no responde, no revienta: lo cuenta', async () => {
      const f = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
      const r = await new ProveedorAsterisk(f).marcar!(CRED, { extension: '101', numero: '300' });

      expect(r.ok).toBe(false);
      expect(r.error).toContain('ECONNREFUSED');
    });
  });
});
