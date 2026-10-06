import {
  firmarCredencial,
  segundosEfectivos,
  SEGUNDOS_POR_DEFECTO,
  SEGUNDOS_MAXIMOS,
  SEGUNDOS_MINIMOS,
} from './credenciales-turn';

/**
 * Lo que se prueba aquí no es «que firme algo», sino que firme EXACTAMENTE lo
 * que coturn va a recalcular. Si el HMAC no coincide con el del servidor, el
 * TURN devuelve 401 y la videollamada se queda sin relevo en redes móviles —
 * una falla que no se ve en WiFi y que nadie reporta bien.
 */
describe('credenciales del TURN', () => {
  // Vector fijo, calculado aparte. No vale compararlo contra la misma función
  // que se está probando: eso pasaría igual si alguien cambia sha1 por sha256
  // o base64 por hex, que es justo lo que rompería la autenticación.
  const SECRETO = 'secreto-de-prueba';
  const AHORA_MS = 1_699_996_400_000;        // 1700000000 - 3600, en ms
  const ESPERADO = 'dNl0G8EszZEUoNT+1+MwY/qkAAA=';

  it('firma el HMAC que coturn espera', () => {
    const c = firmarCredencial(SECRETO, 'sesion1', 3600, AHORA_MS);
    expect(c.username).toBe('1700000000:sesion1');
    expect(c.credential).toBe(ESPERADO);
    expect(c.venceEn).toBe(1_700_000_000);
  });

  it('el username lleva el vencimiento primero y la etiqueta después', () => {
    const c = firmarCredencial(SECRETO, 'abc', 60, AHORA_MS);
    const [vence, etiqueta] = c.username.split(':');
    expect(Number(vence)).toBe(c.venceEn);
    expect(etiqueta).toBe('abc');
  });

  it('una etiqueta con dos puntos no parte el formato', () => {
    // Si el `:` pasara, el username tendría tres campos y coturn leería mal
    // el vencimiento.
    const c = firmarCredencial(SECRETO, 'ses:ion:1', 60, AHORA_MS);
    expect(c.username.split(':')).toHaveLength(2);
    expect(c.username.endsWith(':sesion1')).toBe(true);
  });

  it('una etiqueta vacía o impronunciable no deja el username cojo', () => {
    for (const mala of ['', '   ', '!!!', null, undefined]) {
      const c = firmarCredencial(SECRETO, mala as string, 60, AHORA_MS);
      expect(c.username).toBe('1699996460:falcon');
    }
  });

  it('dos credenciales seguidas no son iguales si cambia el instante', () => {
    const a = firmarCredencial(SECRETO, 'x', 60, AHORA_MS);
    const b = firmarCredencial(SECRETO, 'x', 60, AHORA_MS + 1000);
    expect(a.credential).not.toBe(b.credential);
  });

  it('un secreto distinto produce una firma distinta', () => {
    const a = firmarCredencial(SECRETO, 'x', 60, AHORA_MS);
    const b = firmarCredencial('otro-secreto', 'x', 60, AHORA_MS);
    expect(a.username).toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it('sin secreto no firma nada', () => {
    expect(() => firmarCredencial('', 'x', 60, AHORA_MS)).toThrow();
  });

  describe('vigencia', () => {
    it('acota por arriba y por abajo', () => {
      expect(segundosEfectivos(10)).toBe(SEGUNDOS_MINIMOS);
      expect(segundosEfectivos(999_999)).toBe(SEGUNDOS_MAXIMOS);
      expect(segundosEfectivos(600)).toBe(600);
    });

    it('un valor inválido cae al valor por defecto, no a cero', () => {
      // Cero segundos sería una credencial nacida vencida: el ciudadano
      // llegaría al TURN con algo que ya no sirve.
      for (const malo of [undefined, NaN, Infinity, -5, 'diez' as unknown as number]) {
        expect(segundosEfectivos(malo as number)).toBe(
          malo === -5 ? SEGUNDOS_MINIMOS : SEGUNDOS_POR_DEFECTO,
        );
      }
    });

    it('el vencimiento sale del instante dado, no del reloj', () => {
      const c = firmarCredencial(SECRETO, 'x', 120, 1_000_000_000_000);
      expect(c.venceEn).toBe(1_000_000_000 + 120);
    });
  });
});
