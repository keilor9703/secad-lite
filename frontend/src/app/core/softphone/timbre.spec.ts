import { Timbre } from './timbre';

/**
 * El timbre.
 *
 * Lo que se protege no es el sonido —eso se oye, no se prueba— sino las tres
 * cosas que lo dejan mudo o insoportable: que no arranque dos veces, que pare
 * de verdad, y que no reviente donde no hay audio.
 */
describe('Timbre', () => {
  let timbre: Timbre;

  beforeEach(() => { timbre = new Timbre(); });
  afterEach(() => timbre.soltar());

  it('arranca y queda sonando', () => {
    timbre.arrancar();
    expect(timbre.sonando()).toBeTrue();
  });

  it('arrancarlo dos veces no lo duplica', () => {
    // Dos repiques solapados suenan a avería, y la llamada ya es bastante
    // estrés.
    timbre.arrancar();
    timbre.arrancar();
    timbre.parar();
    expect(timbre.sonando()).toBeFalse();
  });

  it('para cuando se le dice', () => {
    timbre.arrancar();
    timbre.parar();
    expect(timbre.sonando()).toBeFalse();
  });

  it('soltarlo también lo calla', () => {
    timbre.arrancar();
    timbre.soltar();
    expect(timbre.sonando()).toBeFalse();
  });

  it('sin AudioContext en el navegador, no revienta nada', () => {
    // Un puesto con el audio bloqueado por política de empresa no puede
    // quedarse sin teléfono: lo que se pierde es el sonido, no la llamada.
    const original = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;
    try {
      const t = new Timbre();
      expect(() => { t.arrancar(); t.parar(); t.soltar(); }).not.toThrow();
    } finally {
      (window as unknown as { AudioContext: unknown }).AudioContext = original;
    }
  });

  it('parar sin haber arrancado no hace nada raro', () => {
    expect(() => timbre.parar()).not.toThrow();
    expect(timbre.sonando()).toBeFalse();
  });
});
