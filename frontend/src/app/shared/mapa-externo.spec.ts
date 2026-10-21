import { enlaceDeMapa } from './mapa-externo';

/**
 * El enlace que abre el despachador cuando pulsa unas coordenadas.
 *
 * Abría OpenStreetMap teniendo Google Maps contratado y pagado. Más allá del
 * gasto, el operador necesita reconocer lo que ve: en Colombia los nombres de
 * barrio y los negocios de Google son los que coinciden con lo que le dice el
 * ciudadano por teléfono.
 */
describe('enlaceDeMapa', () => {
  it('lleva a Google Maps, no a OpenStreetMap', () => {
    const url = enlaceDeMapa(6.1845, -75.5986);

    expect(url).toContain('google.com/maps');
    expect(url).not.toContain('openstreetmap');
  });

  it('el punto va en la URL, con su signo', () => {
    // Colombia está en longitud negativa: perder el menos manda el mapa a
    // China. No es una exageración, es el error clásico de las coordenadas.
    expect(enlaceDeMapa(6.1845, -75.5986)).toContain('query=6.1845,-75.5986');
  });

  it('usa la forma que NO consume cuota ni necesita la clave', () => {
    // `maps/search/?api=1` es la URL universal documentada: gratis, y en un
    // móvil abre la aplicación en vez del navegador. Una URL con clave
    // gastaría del presupuesto de la API cada vez que alguien mira un caso.
    const url = enlaceDeMapa(6.1845, -75.5986);

    expect(url).toContain('api=1');
    expect(url).not.toContain('key=');
  });

  it('el cero es una coordenada válida y se escribe', () => {
    // El ecuador pasa por Colombia. Un `||` en vez de un `??` lo borraría.
    expect(enlaceDeMapa(0, -75.5)).toContain('query=0,-75.5');
  });
});
