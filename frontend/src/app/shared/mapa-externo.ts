/**
 * EL ENLACE A UN MAPA EXTERNO, PARA UNAS COORDENADAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ GOOGLE Y NO OPENSTREETMAP
 *
 * Porque es el proveedor contratado, y porque el operador que abre ese enlace
 * necesita reconocer lo que ve. En Colombia la cobertura de calles, nombres de
 * barrio y negocios de Google es la que coincide con lo que le va a decir el
 * ciudadano por teléfono; abrirle otro mapa le obliga a traducir.
 *
 * Los mapas DENTRO de FALCON ya son de Google (Recepción), con Leaflet y
 * teselas de OpenStreetMap solo como respaldo cuando falta la clave. Este
 * enlace se había quedado atrás.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA URL Y NO OTRA
 *
 * `maps/search/?api=1` es la forma documentada por Google para enlazar a un
 * punto desde cualquier sitio: **no consume cuota ni necesita la clave** —así
 * que no gasta del presupuesto de la API— y en un móvil abre la aplicación de
 * Google Maps en vez del navegador, que es lo que quiere un despachador con el
 * teléfono en la mano.
 */
export function enlaceDeMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
