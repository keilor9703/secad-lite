/**
 * Cuándo hay que pedirle al ciudadano que TOQUE la pantalla.
 *
 * La página del ciudadano no le pide tocar nada: abre el enlace, concede
 * cámara y micrófono en el diálogo del navegador —que no es una interacción
 * con la página— y la llamada entra sola. Eso deja dos cosas a medias en
 * Safari/iOS, y las dos en silencio:
 *
 *  - La voz del operador no suena (ver `audio-operador.ts`).
 *  - La ubicación nunca se pide. Aquí no afirmo que Safari EXIJA un gesto
 *    —la documentación de Apple no lo dice— pero pedirla sin interacción y
 *    justo detrás del permiso de cámara es el camino frágil, y pedirla desde
 *    un toque es el que funciona en todas partes.
 *
 * Un solo toque arregla las dos, así que se pide una sola vez y se decide
 * aquí, aparte, para poder probar la decisión entera.
 */

export interface EstadoCiudadano {
  /** El navegador rechazó reproducir la voz del operador. */
  audioBloqueado: boolean;
  /** Ya está llegando la posición. */
  ubicacionActiva: boolean;
  /** El ciudadano dijo que NO a la ubicación. Su decisión: no se le insiste. */
  ubicacionDenegada: boolean;
  /** Pasó el plazo de cortesía sin que llegara ninguna posición. */
  plazoUbicacionCumplido: boolean;
}

/**
 * Plazo antes de dar por hecho que la ubicación no va a llegar sola.
 *
 * Un GPS frío tarda. Si se pregunta demasiado pronto, se le pone un aviso
 * delante a alguien que está describiendo una emergencia y que iba a recibir
 * la posición igual dos segundos después.
 */
export const PLAZO_UBICACION_MS = 8_000;

export function hayQuePedirToque(e: EstadoCiudadano): boolean {
  if (e.audioBloqueado) return true;
  // No oír al operador es grave; no tener la ubicación es recuperable
  // —el operador puede preguntarla— así que esto solo se enciende cuando ya
  // está claro que no va a llegar por su cuenta, y nunca si el ciudadano la
  // negó a propósito.
  return !e.ubicacionActiva && !e.ubicacionDenegada && e.plazoUbicacionCumplido;
}

/** Qué decirle, según lo que falte. Pedir sonido y ubicación no es lo mismo. */
export function textoDelToque(e: EstadoCiudadano): string {
  const faltaUbicacion = !e.ubicacionActiva && !e.ubicacionDenegada;
  if (e.audioBloqueado && faltaUbicacion) return 'Toque aquí para escuchar al operador y enviar su ubicación';
  if (e.audioBloqueado) return 'Toque aquí para escuchar al operador';
  return 'Toque aquí para enviar su ubicación al operador';
}
