import { createHash, createHmac } from 'node:crypto';
import {
  cadenaParametros, encabezadoAutorizacion, firmarPeticion, pareceCredencialZadarma,
} from './zadarma.api';

/**
 * La firma de las llamadas a la API de Zadarma.
 *
 * Es imposible depurarla desde fuera: si no cuadra, el servidor responde
 * «authentication failed» y no dice en qué no cuadra. Así que cada pieza se
 * comprueba aquí, contra el algoritmo del SDK oficial de la comunidad.
 */
describe('la firma de la API de Zadarma', () => {
  const SECRETO = 'b1c2d3e4f5a6b7c8d9e0';

  describe('los parámetros', () => {
    it('van ordenados por nombre, no en el orden en que se escribieron', () => {
      // Es la causa más probable de una firma que no cuadra: el orden del
      // objeto en JavaScript es el de escritura, y Zadarma firma el alfabético.
      expect(cadenaParametros({ to: '573001234567', from: '101', sip: '101' }))
        .toBe('from=101&sip=101&to=573001234567');
    });

    it('omite lo que no se manda, en vez de firmar un vacío', () => {
      // Un `sip=` vacío firmado y no enviado (o al revés) rompe la firma.
      expect(cadenaParametros({ from: '101', sip: undefined, to: '300', predicted: '' }))
        .toBe('from=101&to=300');
    });

    it('el `+` de un número E.164 se escapa, no se convierte en espacio', () => {
      expect(cadenaParametros({ to: '+573001234567' })).toBe('to=%2B573001234567');
    });

    it('codifica como PHP: el espacio es `+` y `~` no se deja intacto', () => {
      // `encodeURIComponent` deja pasar !'()*~ y usa %20 para el espacio; PHP
      // no. Con teléfonos da lo mismo, con texto libre no.
      expect(cadenaParametros({ message: 'hola mundo' })).toBe('message=hola+mundo');
      expect(cadenaParametros({ message: '~(a)~' })).toBe('message=%7E%28a%29%7E');
    });
  });

  describe('la firma', () => {
    it('es base64 del HEX del HMAC, no del digest binario', () => {
      // LA trampa. Con el binario la API rechaza todo y el mensaje de error no
      // se parece a la causa.
      const metodo = '/v1/request/callback/';
      const cadena = 'from=101&to=573001234567';
      const md5 = createHash('md5').update(cadena).digest('hex');
      const hex = createHmac('sha1', SECRETO).update(metodo + cadena + md5).digest('hex');

      expect(firmarPeticion(metodo, cadena, SECRETO)).toBe(Buffer.from(hex, 'utf8').toString('base64'));
      expect(firmarPeticion(metodo, cadena, SECRETO))
        .not.toBe(createHmac('sha1', SECRETO).update(metodo + cadena + md5).digest('base64'));
    });

    it('incluye el md5 de los parámetros: el mismo método con otros datos firma distinto', () => {
      const a = firmarPeticion('/v1/request/callback/', 'from=101&to=300', SECRETO);
      const b = firmarPeticion('/v1/request/callback/', 'from=101&to=301', SECRETO);
      expect(a).not.toBe(b);
    });

    it('incluye el método: los mismos datos en otra ruta firman distinto', () => {
      const a = firmarPeticion('/v1/request/callback/', 'from=101', SECRETO);
      const b = firmarPeticion('/v1/info/balance/', 'from=101', SECRETO);
      expect(a).not.toBe(b);
    });

    it('una petición sin parámetros firma el md5 de la cadena vacía', () => {
      const vacio = createHash('md5').update('').digest('hex');
      const esperada = Buffer.from(
        createHmac('sha1', SECRETO).update('/v1/info/balance/' + vacio).digest('hex'), 'utf8',
      ).toString('base64');
      expect(firmarPeticion('/v1/info/balance/', '', SECRETO)).toBe(esperada);
    });
  });

  it('el encabezado lleva la llave y la firma separadas por dos puntos', () => {
    expect(encabezadoAutorizacion('71278d8e6746cb220a36', 'ZmlybWE=')).toBe('71278d8e6746cb220a36:ZmlybWE=');
  });

  describe('la forma de la credencial', () => {
    it('veinte caracteres alfanuméricos', () => {
      expect(pareceCredencialZadarma('71278d8e6746cb220a36')).toBe(true);
    });

    it('con un espacio pegado al copiar, no', () => {
      // Es el error real: se pega del panel con un espacio y todo falla con un
      // «authentication failed» que no dice nada.
      expect(pareceCredencialZadarma('71278d8e6746cb220a36 ')).toBe(false);
      expect(pareceCredencialZadarma('71278d8e6746cb220')).toBe(false);
    });
  });
});
