/**
 * El marcador de un caso sobre un mapa. UNO solo, para los dos mapas.
 *
 * Antes eran dos cosas distintas: en el módulo Mapa, un círculo de 14 px que
 * sobre la textura de OpenStreetMap —llena de iconos de comercios, cruces de
 * hospital, manchas de color— simplemente no se percibía; y en Recepción, el
 * emoji 📍, que lo pinta el sistema operativo y por lo tanto cambia de forma
 * y de color en cada equipo.
 *
 * Este es una gota con el signo de admiración dentro: la forma dice «aquí» y
 * el signo dice «incidente», que es exactamente lo que es un caso. A 30×38 se
 * ve de un vistazo sobre cualquier fondo, y el borde claro lo despega de la
 * cartografía por debajo.
 *
 * Va como SVG en línea dentro del `divIcon` de Leaflet y no como PNG: el
 * empaquetador no resuelve los PNG de Leaflet, y un SVG hereda el color del
 * tema sin necesidad de una imagen por variante.
 */

export type PrioridadPin = 'alta' | 'media' | 'baja';

/** Medidas del icono, para pasárselas a Leaflet. La punta es el ancla. */
export const PIN_ANCHO = 30;
export const PIN_ALTO = 38;

/**
 * Colores por prioridad. Literales y no variables del tema a propósito: el
 * marcador se lee sobre la cartografía, no sobre el fondo de la aplicación,
 * así que tiene que mantener su contraste en claro y en oscuro por igual.
 */
const COLOR: Record<PrioridadPin, string> = {
  alta: '#d13c3c',
  media: '#d9892a',
  baja: '#2f7fc4',
};

/**
 * El SVG del marcador. `prioridad` pinta el cuerpo; sin ella usa el acento de
 * la marca, que es el caso de Recepción —ahí el pin señala la dirección que
 * se está digitando, y todavía no hay una prioridad que mostrar—.
 */
export function pinCasoSvg(prioridad?: PrioridadPin | null): string {
  const relleno = prioridad ? COLOR[prioridad] : '#0c7e92';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_ANCHO}" height="${PIN_ALTO}" viewBox="0 0 30 38" aria-hidden="true">
  <defs>
    <filter id="pc-s" x="-55%" y="-30%" width="210%" height="180%">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#0b1b26" flood-opacity="0.45"/>
    </filter>
  </defs>
  <path filter="url(#pc-s)"
        d="M15 1.6c-6.1 0-11.1 4.9-11.1 11 0 7.9 9.6 17.5 10.1 18 .3.3.7.3 1 0 .4-.5 10.1-10.1 10.1-18 0-6.1-5-11-11.1-11z"
        fill="${relleno}" stroke="#ffffff" stroke-width="2.2"/>
  <path d="M15 6.9v7.6" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="15" cy="18.4" r="1.55" fill="#ffffff"/>
</svg>`;
}
