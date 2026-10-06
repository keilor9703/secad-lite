import { diasEfectivos } from './dias-efectivos';

/**
 * El plazo de UNA pasada no puede convertirse en el plazo de siempre.
 *
 * Esto nació de una tentación concreta: para comprobar la cadena de archivado
 * el día que se configura el almacén, bajar `ARCHIVO_DIAS` a 1 y acordarse de
 * devolverlo. Acordarse no es un mecanismo. Si se olvida, al día siguiente se
 * archiva TODO lo que tenga más de un día, en silencio.
 *
 * La regla que fija esto: el valor suelto solo puede ACORTAR el plazo, nunca
 * alargarlo, y nunca se guarda.
 */
describe('plazo de una sola pasada', () => {
  it('sin valor suelto manda el configurado', () => {
    expect(diasEfectivos(90)).toBe(90);
    expect(diasEfectivos(90, undefined)).toBe(90);
  });

  it('acorta cuando se pide acortar: es para lo que existe', () => {
    expect(diasEfectivos(90, 1)).toBe(1);
    expect(diasEfectivos(90, 30)).toBe(30);
  });

  it('NO puede alargar el plazo', () => {
    // Una llamada suelta no debe poder dejar sin archivar lo que ya tocaba:
    // para alargar está ARCHIVO_DIAS, que es deliberado y queda escrito.
    expect(diasEfectivos(90, 365)).toBe(90);
  });

  it('un valor absurdo cae al configurado en vez de archivarlo todo', () => {
    // Cero o negativo significaría «todo, incluso lo grabado hace un minuto».
    for (const malo of [0, -1, -999, NaN, Infinity]) {
      expect(diasEfectivos(90, malo)).toBe(90);
    }
  });

  it('los decimales se truncan hacia abajo, no se redondean', () => {
    expect(diasEfectivos(90, 1.9)).toBe(1);
  });
});
