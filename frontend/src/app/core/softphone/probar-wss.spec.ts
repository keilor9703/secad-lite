import { probarWss } from './probar-wss';

/**
 * El probador de direcciones de WebSocket.
 *
 * Existe porque la dirección de señalización no siempre la publica el
 * proveedor —Zadarma solo documenta su widget— y averiguarla acaba siendo
 * pegar una candidata. Lo que se protege es que los tres desenlaces se
 * distingan: contestó y habla SIP, contestó y NO habla SIP, y no contestó.
 * Llevan a tres sitios distintos y mezclarlos manda a buscar donde no es.
 */
describe('probarWss', () => {
  /** Un WebSocket de mentira al que se le dice qué hacer. */
  function socketFalso(): { abrir: (u: string, p: string) => WebSocket; ultimo: () => any } {
    let creado: any;
    const abrir = (url: string, protocolo: string) => {
      creado = { url, protocoloPedido: protocolo, protocol: '', close: () => undefined };
      return creado as WebSocket;
    };
    return { abrir, ultimo: () => creado };
  }

  it('rechaza lo que ni siquiera es una dirección segura, sin abrir nada', async () => {
    // `ws://` sin cifrar no sirve: WebRTC exige https y el navegador lo
    // bloquearía de todos modos.
    for (const malo of ['', 'pbx.zadarma.com', 'ws://pbx.zadarma.com', 'https://pbx.zadarma.com']) {
      const r = await probarWss(malo, () => { throw new Error('no debió intentarlo'); });
      expect(r.ok).toBeFalse();
      expect(r.mensaje).toContain('wss://');
    }
  });

  it('pide el subprotocolo «sip», que es lo que negocia una señalización', async () => {
    const s = socketFalso();
    const p = probarWss('wss://ejemplo.com', s.abrir);
    s.ultimo().protocol = 'sip';
    s.ultimo().onopen();
    await p;

    expect(s.ultimo().protocoloPedido).toBe('sip');
    expect(s.ultimo().url).toBe('wss://ejemplo.com');
  });

  it('contestó y negoció SIP: esta es la dirección', async () => {
    const s = socketFalso();
    const p = probarWss('wss://ejemplo.com', s.abrir);
    s.ultimo().protocol = 'sip';
    s.ultimo().onopen();

    const r = await p;
    expect(r.ok).toBeTrue();
    expect(r.mensaje).toContain('Esta es la dirección');
  });

  it('contestó pero NO negoció SIP: avisa que puede ser otra cosa', async () => {
    // Un servidor web o un proxy puede aceptar la conexión por cortesía. Si
    // eso se contara como éxito, se guardaría una dirección que nunca va a
    // registrar un teléfono.
    const s = socketFalso();
    const p = probarWss('wss://ejemplo.com', s.abrir);
    s.ultimo().protocol = '';
    s.ultimo().onopen();

    const r = await p;
    expect(r.ok).toBeTrue();
    expect(r.mensaje).toContain('NO negoció');
  });

  it('rechazada: dice las dos causas posibles, porque el navegador no cuenta cuál', async () => {
    const s = socketFalso();
    const p = probarWss('wss://ejemplo.com', s.abrir);
    s.ultimo().onerror();

    const r = await p;
    expect(r.ok).toBeFalse();
    expect(r.mensaje).toContain('dominio');
  });

  it('si abrir el socket revienta, no revienta la pantalla', async () => {
    const r = await probarWss('wss://ejemplo.com', () => { throw new Error('bloqueado'); });
    expect(r.ok).toBeFalse();
    expect(r.mensaje).toContain('bloqueado');
  });

  it('un segundo aviso después de resolver no cambia el resultado', async () => {
    // Un socket puede disparar error DESPUÉS de abrir. El primer desenlace
    // manda; si no, un éxito se convertiría en fallo medio segundo más tarde.
    const s = socketFalso();
    const p = probarWss('wss://ejemplo.com', s.abrir);
    s.ultimo().protocol = 'sip';
    s.ultimo().onopen();
    s.ultimo().onerror();

    expect((await p).ok).toBeTrue();
  });
});
