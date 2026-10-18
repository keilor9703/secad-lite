import { nombreContenedor, urlAri, urlWss } from './planta-asterisk.entity';
import { redesDe, revisarRedes } from './pbx-troncal.entity';
import { normalizarNumero } from './pbx-numero.entity';

/**
 * Las piezas que se derivan de la planta de un municipio.
 *
 * Son tres líneas cada una y están probadas porque las tres, mal, producen
 * fallos que no se parecen a su causa:
 *
 *  1. **Las direcciones del navegador** van por el 443 y por nombre. Con un
 *     puerto de más, el softphone no se registra en una red corporativa y el
 *     síntoma es «se queda conectando», que no dice nada.
 *  2. **Las redes de la troncal** entran al `identify` de pjsip, y un CIDR
 *     inválido no degrada: Asterisk rechaza el módulo completo y el municipio
 *     queda sin troncal Y sin softphones.
 *  3. **El número** entra al dialplan. Con un guion o sin indicativo no casa
 *     con ningún patrón, y en pantalla todo se ve bien.
 */
describe('derivaciones de la planta propia', () => {
  describe('direcciones de una planta', () => {
    it('el contenedor se llama por el tenant, en minúsculas', () => {
      expect(nombreContenedor('Itagui')).toBe('asterisk-itagui');
      expect(nombreContenedor(' demo ')).toBe('asterisk-demo');
    });

    it('la señalización del navegador va por el 443, sin puerto explícito', () => {
      const planta = { dominioSip: 'itagui-pbx.falconcad.com.co' };
      expect(urlWss(planta)).toBe('wss://itagui-pbx.falconcad.com.co/ws');
      expect(urlWss(planta)).not.toContain('8089');
      expect(urlAri(planta)).toBe('https://itagui-pbx.falconcad.com.co/ari');
    });
  });

  describe('las subredes de la troncal', () => {
    it('acepta las dos subredes del SBC, separadas como las pegue quien sea', () => {
      expect(redesDe('81.23.252.0/24, 81.23.253.0/24')).toEqual([
        '81.23.252.0/24',
        '81.23.253.0/24',
      ]);
      expect(redesDe('81.23.252.0/24\n81.23.253.0/24')).toEqual([
        '81.23.252.0/24',
        '81.23.253.0/24',
      ]);
      expect(revisarRedes('81.23.252.0/24 81.23.253.0/24')).toBeNull();
    });

    it('una IP suelta también vale: hay operadores que dan un solo SBC', () => {
      expect(revisarRedes('190.60.10.1')).toBeNull();
    });

    it('vacío es válido: una troncal con registro no identifica por IP', () => {
      expect(revisarRedes(null)).toBeNull();
      expect(revisarRedes('   ')).toBeNull();
      expect(redesDe(undefined)).toEqual([]);
    });

    it('rechaza lo que tumbaría el módulo pjsip, nombrando el valor', () => {
      expect(revisarRedes('81.23.252.0/24, no-es-una-red')).toContain(
        'no-es-una-red',
      );
      expect(revisarRedes('81.23.252.0/99')).toContain('81.23.252.0/99');
      expect(revisarRedes('300.1.1.1')).toContain('300.1.1.1');
      expect(revisarRedes('81.23.252')).toContain('81.23.252');
      expect(revisarRedes('81.23.252.0/24/8')).toContain('81.23.252.0/24/8');
    });
  });

  describe('el número que marca el ciudadano', () => {
    it('deja en E.164 lo que un humano escribe con guiones y paréntesis', () => {
      expect(normalizarNumero('+57 (604) 234 56 78')).toBe('+576042345678');
      expect(normalizarNumero('300-123-4567')).toBe('+573001234567');
    });

    it('un celular o un fijo colombiano sin indicativo recibe el 57', () => {
      expect(normalizarNumero('3001234567')).toBe('+573001234567');
      expect(normalizarNumero('6042345678')).toBe('+576042345678');
    });

    it('no le pone 57 a lo que ya trae otro país', () => {
      expect(normalizarNumero('18335308128')).toBe('+18335308128');
      expect(normalizarNumero('+1 833 530 8128')).toBe('+18335308128');
    });

    it('quita el 00 de la marcación internacional, que no es parte del número', () => {
      expect(normalizarNumero('0057 3001234567')).toBe('+573001234567');
    });

    it('un número corto no lleva + ni indicativo: el 123 es el 123', () => {
      expect(normalizarNumero('123', 'corto')).toBe('123');
      expect(normalizarNumero('+123', 'corto')).toBe('123');
    });

    it('vacío sale vacío, y no un «+» solo que casaría con cualquier patrón', () => {
      expect(normalizarNumero('')).toBe('');
      expect(normalizarNumero('   ')).toBe('');
      expect(normalizarNumero('abc')).toBe('');
    });
  });
});
