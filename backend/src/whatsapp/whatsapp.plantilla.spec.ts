import { rutaDeEnlace } from './whatsapp.service';

/**
 * LA PLANTILLA APROBADA: ESCRIBIRLE PRIMERO AL CIUDADANO.
 *
 * WhatsApp no deja escribirle a nadie que no haya escrito antes. Dentro de la
 * ventana de 24 horas vale texto libre; fuera de ella, lo único que Meta
 * entrega es una plantilla que revisó y aprobó de antemano.
 *
 * La plantilla aprobada el 22/10/2026 (`videollamadafalconcad`, es_CO) lleva
 * el dominio ESCRITO DENTRO y su botón recibe solo lo que va después.
 */
describe('rutaDeEnlace', () => {
  it('del enlace completo saca solo la ruta', () => {
    // Mandar la URL entera produciría
    // `https://falconcad.com.co/https://falconcad.com.co/v/...`: un enlace
    // muerto que el operador daría por enviado, y el ciudadano esperando una
    // videollamada que nunca va a poder abrir.
    expect(rutaDeEnlace('https://falconcad.com.co/v/demo-k7m2x9qr4t8v'))
      .toBe('/v/demo-k7m2x9qr4t8v');
  });

  it('sirve con cualquier dominio, no solo el de producción', () => {
    // Un municipio en su propio dominio tiene que funcionar igual.
    expect(rutaDeEnlace('https://itagui.gov.co/v/itagui-abc123'))
      .toBe('/v/itagui-abc123');
  });

  it('conserva lo que venga después del signo de interrogación', () => {
    expect(rutaDeEnlace('https://x.co/v/abc?t=1')).toBe('/v/abc?t=1');
  });

  describe('lo que NO se manda', () => {
    it('una URL sin ruta: el botón llevaría a la portada', () => {
      // Y el ciudadano se quedaría mirando la página de inicio sin saber qué
      // hacer, en mitad de una emergencia.
      expect(rutaDeEnlace('https://falconcad.com.co')).toBeNull();
      expect(rutaDeEnlace('https://falconcad.com.co/')).toBeNull();
    });

    it('algo que no es una URL', () => {
      expect(rutaDeEnlace('')).toBeNull();
      expect(rutaDeEnlace('v/abc')).toBeNull();
      expect(rutaDeEnlace('no es una url')).toBeNull();
    });
  });
});
