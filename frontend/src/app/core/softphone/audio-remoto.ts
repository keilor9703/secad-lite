/**
 * ENGANCHAR EL AUDIO DE LA OTRA PARTE, A MANO.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Pasó en producción: la llamada se establecía, al operador lo oían del otro
 * lado —el micrófono salía bien— y él no oía nada. Audio de ida sí, de vuelta
 * no.
 *
 * La causa es siempre la misma clase de cosa: el `<audio>` nunca recibió el
 * flujo remoto. SIP.js lo engancha por su cuenta si se le pasa el elemento en
 * las opciones, pero eso depende de que el elemento ya exista cuando se
 * construye el gestor y de un par de detalles más que no se pueden comprobar
 * desde aquí. Así que se hace explícito.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EL DETALLE QUE PRODUCE FALSAS ALARMAS
 *
 * SIP.js lo dice en su propia documentación: «el flujo remoto no tiene pistas
 * al principio, así que no se debe suponer que las tenga; use el evento
 * `addtrack`». Contar las pistas en el momento en que la llamada se establece
 * y concluir «no hay audio» es, por tanto, una conclusión que a veces llega
 * demasiado pronto.
 *
 * Por eso esto hace las dos cosas: devuelve lo que hay AHORA —que es lo que
 * se le muestra al operador de inmediato— y, si no hay nada, se queda
 * esperando la primera pista para corregirse. Un aviso de «sin audio» que no
 * se retracta cuando el audio llega es peor que no avisar: la segunda vez
 * nadie le cree.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function engancharAudioRemoto(
  el: HTMLAudioElement | null | undefined,
  flujo: MediaStream | null | undefined,
  alAparecerPista: (pistas: number) => void,
): number {
  if (!el || !flujo) return 0;

  el.srcObject = flujo;
  el.muted = false;
  // `play()` puede ser rechazado por la política de reproducción automática.
  // No debería —contestar es un clic— pero si pasa, que no reviente: el
  // número de pistas ya dice si había audio que oír.
  void el.play?.()?.catch?.(() => undefined);

  const pistas = flujo.getAudioTracks().length;
  if (pistas === 0) {
    const alLlegar = (): void => {
      flujo.removeEventListener('addtrack', alLlegar);
      alAparecerPista(flujo.getAudioTracks().length);
    };
    flujo.addEventListener('addtrack', alLlegar);
  }
  return pistas;
}

/** Suelta el flujo del elemento: un `srcObject` muerto estorba a la próxima llamada. */
export function soltarAudioRemoto(el: HTMLAudioElement | null | undefined): void {
  if (el) el.srcObject = null;
}
