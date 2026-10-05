/**
 * Cuándo dejar de esperar a Google y montar el mapa de respaldo.
 *
 * El mapa de Google puede fallar DESPUÉS de que nuestro código le haya
 * entregado el control: la clave carga, el SDK carga, y al pintar el mapa
 * Google muestra su propio cartel —«Esta página no cargó bien Google Maps»—
 * dentro del contenedor. Desde fuera parece que todo fue bien, así que el
 * respaldo de OpenStreetMap nunca se activaba y el operador se quedaba sin
 * mapa de ninguna clase. En una central, un mapa que a veces no está es peor
 * que uno más feo que siempre está.
 *
 * Dos señales, y basta con una:
 *
 *  - `gm_authFailure`: Google rechazó la clave (cuota agotada, facturación,
 *    restricciones). Es inmediato y no hay nada que esperar.
 *  - El mapa nunca pintó una tesela. Google avisa del primer pintado con el
 *    evento `tilesloaded`; si no llega en un plazo razonable, no va a llegar.
 */

export interface EstadoMapaGoogle {
  /** Google rechazó la clave. */
  autenticacionFallo: boolean;
  /** Llegó el evento `tilesloaded`: el mapa pintó. */
  teselasCargadas: boolean;
  /** Venció el plazo de espera. */
  plazoCumplido: boolean;
}

/**
 * Plazo antes de dar por perdido el mapa de Google.
 *
 * Generoso a propósito: en un portátil con una conexión mala las teselas
 * pueden tardar varios segundos, y cambiar de mapa a mitad de carga sería
 * peor que esperar. Ocho segundos sin UNA sola tesela no es lentitud.
 */
export const PLAZO_TESELAS_MS = 8_000;

export function hayQueCaerARespaldo(e: EstadoMapaGoogle): boolean {
  if (e.teselasCargadas) return false;        // pintó: no se toca nada
  return e.autenticacionFallo || e.plazoCumplido;
}
