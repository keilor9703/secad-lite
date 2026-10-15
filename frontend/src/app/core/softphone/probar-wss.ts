/**
 * ¿Esta dirección `wss://` es una señalización SIP que acepta a FALCON?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * La dirección del WebSocket la publica cada proveedor donde quiere, y a veces
 * no la publica: Zadarma, por ejemplo, solo documenta su widget. Averiguarla
 * termina siendo pegar una candidata y ver qué pasa — y lo que pasa, sin esto,
 * es un error de WebSocket en la consola del navegador que nadie va a mirar.
 *
 * Esto convierte esa adivinanza en una respuesta: se abre la conexión, se
 * espera, y se dice si contestó, si rechazó o si no está. Tres resultados
 * distintos que llevan a tres sitios distintos.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE PRUEBA DESDE EL NAVEGADOR Y NO DESDE EL SERVIDOR
 *
 * Porque el que se va a registrar es el navegador, y los proveedores filtran
 * por ORIGEN: Zadarma pide autorizar `https://falconcad.com.co` en su panel.
 * Una prueba desde el servidor dirÍa que la dirección existe y no dirÍa nada
 * sobre lo único que importa — si acepta a FALCON.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ResultadoProbar =
  | { ok: true; subprotocolo: string; mensaje: string }
  | { ok: false; mensaje: string };

/** Lo que tarda en darse por vencida una dirección que no contesta. */
const ESPERA_MS = 6000;

/**
 * Abre un WebSocket con el subprotocolo `sip` y dice qué pasó.
 *
 * El subprotocolo importa: un servidor de señalización SIP lo negocia, y uno
 * que acepte la conexión SIN negociarlo casi seguro es otra cosa (una web, un
 * proxy) que respondió por cortesía. Por eso se mira y se dice.
 */
export function probarWss(
  url: string,
  abrir: (u: string, p: string) => WebSocket = (u, p) => new WebSocket(u, p),
): Promise<ResultadoProbar> {
  const limpia = (url ?? '').trim();
  if (!/^wss:\/\/[^\s]+$/i.test(limpia)) {
    return Promise.resolve({
      ok: false,
      mensaje: 'Eso no es una dirección de WebSocket segura. Debe empezar por «wss://».',
    });
  }

  return new Promise<ResultadoProbar>((resolver) => {
    let resuelto = false;
    const terminar = (r: ResultadoProbar) => {
      if (resuelto) return;
      resuelto = true;
      try { socket.close(); } catch { /* ya estaba cerrado */ }
      resolver(r);
    };

    let socket: WebSocket;
    try {
      socket = abrir(limpia, 'sip');
    } catch (e) {
      return resolver({ ok: false, mensaje: `No se pudo abrir la conexión: ${(e as Error)?.message ?? 'error desconocido'}.` });
    }

    const reloj = setTimeout(() => terminar({
      ok: false,
      mensaje: 'No contestó en seis segundos. O la dirección no existe, o hay algo en el camino '
        + 'bloqueando el WebSocket.',
    }), ESPERA_MS);

    socket.onopen = () => {
      clearTimeout(reloj);
      const sub = socket.protocol || '';
      terminar(sub.toLowerCase() === 'sip'
        ? { ok: true, subprotocolo: sub, mensaje: 'Contestó y negoció el protocolo SIP. Esta es la dirección.' }
        : {
          ok: true,
          subprotocolo: sub,
          mensaje: 'Contestó, pero NO negoció el protocolo SIP' + (sub ? ` (dijo «${sub}»)` : '')
            + '. Puede ser un servidor web o un proxy, no la señalización de la centralita.',
        });
    };

    // El navegador no cuenta POR QUÉ falló un WebSocket —es a propósito, para
    // no filtrar qué hay en una red ajena—, así que aquí no se puede decir
    // más que «no se pudo», y conviene decirlo así en vez de inventar.
    socket.onerror = () => {
      clearTimeout(reloj);
      terminar({
        ok: false,
        mensaje: 'La conexión fue rechazada. Puede ser que la dirección no sea esa, o que el '
          + 'proveedor no tenga autorizado el dominio de FALCON.',
      });
    };
  });
}
