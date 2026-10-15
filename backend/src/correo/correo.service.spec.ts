import { CorreoService, MensajeCorreo } from './correo.service';

/**
 * Las dos reglas del servicio de correo, probadas:
 *
 *  1. **`enviar()` no lanza nunca.** Ni sin configuración, ni con una
 *     dirección mal escrita, ni con un 400 del proveedor, ni con la red caída.
 *     Quien llama decide qué hacer con el fallo — crear un usuario o abrir un
 *     ticket no puede abortarse porque un tercero esté caído.
 *  2. **`responderA` solo viaja si tiene forma de correo.** El proveedor
 *     rechaza con un 400 un `replyTo` mal formado, y ese 400 se lleva el
 *     mensaje entero: antes que un correo sin «Responder», ninguno.
 */
describe('CorreoService', () => {
  const MENSAJE: MensajeCorreo = {
    para: 'jperez@soacha.gov.co',
    asunto: 'Prueba',
    html: '<p>hola</p>',
    texto: 'hola',
  };

  let fetchOriginal: typeof globalThis.fetch;
  let apiKeyPrevia: string | undefined;

  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    apiKeyPrevia = process.env.BREVO_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    if (apiKeyPrevia === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = apiKeyPrevia;
  });

  /** Arma el servicio con una clave puesta y `fetch` falso y observable. */
  function armar(respuesta: Partial<Response> | Error = { ok: true, json: async () => ({ messageId: 'm1' }) } as Response) {
    process.env.BREVO_API_KEY = 'clave-de-prueba';
    const llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
    globalThis.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body ?? '{}')) });
      if (respuesta instanceof Error) throw respuesta;
      return respuesta as Response;
    }) as unknown as typeof globalThis.fetch;
    return { svc: new CorreoService(), llamadas };
  }

  it('manda el mensaje y devuelve el identificador del proveedor', async () => {
    const { svc, llamadas } = armar();

    const r = await svc.enviar(MENSAJE);

    expect(r).toEqual({ ok: true, id: 'm1' });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].cuerpo.subject).toBe('Prueba');
    expect(llamadas[0].cuerpo.to).toEqual([{ email: 'jperez@soacha.gov.co' }]);
  });

  it('incluye replyTo cuando la dirección de respuesta tiene forma de correo', async () => {
    const { svc, llamadas } = armar();

    await svc.enviar({ ...MENSAJE, responderA: 'mesa@falconcad.com.co' });

    expect(llamadas[0].cuerpo.replyTo).toEqual({ email: 'mesa@falconcad.com.co' });
  });

  it('omite replyTo cuando no hay dirección, o no es una dirección', async () => {
    const { svc, llamadas } = armar();

    await svc.enviar(MENSAJE);
    await svc.enviar({ ...MENSAJE, responderA: '' });
    await svc.enviar({ ...MENSAJE, responderA: 'no es un correo' });

    expect(llamadas).toHaveLength(3);
    for (const l of llamadas) expect(l.cuerpo.replyTo).toBeUndefined();
  });

  it('sin clave configurada no manda nada y lo dice, sin lanzar', async () => {
    delete process.env.BREVO_API_KEY;
    const svc = new CorreoService();
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;

    const r = await svc.enviar(MENSAJE);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('no está configurado');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('una dirección de destino mal escrita no llega al proveedor', async () => {
    const { svc, llamadas } = armar();

    const r = await svc.enviar({ ...MENSAJE, para: 'jperez@' });

    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });

  it('un rechazo del proveedor devuelve el detalle, recortado y sin lanzar', async () => {
    const { svc } = armar({
      ok: false, status: 402, text: async () => 'x'.repeat(500),
    } as unknown as Response);

    const r = await svc.enviar(MENSAJE);

    expect(r.ok).toBe(false);
    expect(r.error).toContain('402');
    // La columna que lo guarda son 300 caracteres.
    expect((r.error ?? '').length).toBeLessThanOrEqual(291);
  });

  it('la red caída tampoco lanza', async () => {
    const { svc } = armar(new Error('ECONNREFUSED'));

    const r = await svc.enviar(MENSAJE);

    expect(r).toEqual({ ok: false, error: 'ECONNREFUSED' });
  });

  it('una respuesta que no es JSON se trata como enviada, sin identificador', async () => {
    const { svc } = armar({
      ok: true, json: async () => { throw new Error('no es JSON'); },
    } as unknown as Response);

    const r = await svc.enviar(MENSAJE);

    expect(r.ok).toBe(true);
    expect(r.id).toBeUndefined();
  });
});
