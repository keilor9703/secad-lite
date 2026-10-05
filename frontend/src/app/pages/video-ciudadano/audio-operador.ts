/**
 * Que la voz del operador SUENE en el teléfono del ciudadano.
 *
 * Confiar en el atributo `autoplay` de un `<audio>` no basta, y en iPhone con
 * Safari —que es donde apareció— no basta por tres motivos distintos y
 * acumulativos:
 *
 *  1. NADIE LLAMABA A `play()`. Los navegadores bloquean la reproducción con
 *     sonido mientras el usuario no haya interactuado con la PÁGINA, y esta no
 *     le pide que toque nada: abre el enlace, concede cámara y micrófono en el
 *     diálogo del navegador —que no cuenta como interacción con la página— y
 *     la llamada entra sola. La pista llegaba bien por WebRTC y se quedaba en
 *     un elemento pausado, en silencio, sin error en ninguna parte. iOS es el
 *     más estricto de todos con esto.
 *
 *  2. SAFARI NO REPRODUCE UN `MediaStream` REMOTO EN UN `<audio>` de forma
 *     fiable. Es un fallo conocido de WebKit, de años. La vía que sí funciona
 *     es un `<video playsinline>`, aunque lo que se quiera sea solo el sonido
 *     — por eso el elemento de esta página es un vídeo invisible y no un
 *     `<audio>`. Tampoco puede estar en `display: none`: iOS no reproduce
 *     medios de un elemento que no esté en el diseño.
 *
 *  3. CUANDO SE ATASCA, LO DESATASCA UN `pause()` + `play()`. Es el remedio
 *     documentado para el caso en que la pista está presente y aun así no
 *     suena. Se aplica en el camino del gesto del ciudadano, que es donde el
 *     navegador deja hacerlo y donde además hace falta.
 *
 * Vive aparte del componente para poder probarlo sin navegador ni WebRTC.
 */

/** Lo mínimo del elemento de medios que hace falta aquí. Así se prueba con un doble. */
export interface ReproductorAudio {
  /* `MediaProvider`, no `MediaStream`: es el tipo real de `HTMLMediaElement.srcObject`. */
  srcObject: MediaProvider | null;
  play(): Promise<void>;
  pause?(): void;
}

export interface OpcionesSonar {
  /**
   * Reinicia la reproducción antes de arrancarla. Solo tiene sentido desde un
   * gesto del ciudadano: es el remedio del punto 3, y fuera de un gesto el
   * `play()` posterior se rechazaría igual.
   */
  reiniciar?: boolean;
}

/**
 * Conecta la pista y la hace sonar. Devuelve si SUENA.
 *
 * `false` cuando todavía no hay elemento o pista —no hay nada que sonar— y
 * cuando el navegador rechazó la reproducción. Quien llama decide qué hacer
 * con cada caso; lo que no puede pasar es que nadie lo mire, que es
 * exactamente lo que pasaba.
 */
export async function intentarSonar(
  el: ReproductorAudio | null | undefined,
  pista: MediaStream | null,
  opciones: OpcionesSonar = {},
): Promise<boolean> {
  if (!el || !pista) return false;
  // Reasignar el mismo stream reinicia el elemento en algunos navegadores.
  if (el.srcObject !== pista) el.srcObject = pista;
  if (opciones.reiniciar) el.pause?.();
  try {
    await el.play();
    return true;
  } catch {
    return false;
  }
}
