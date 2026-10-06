import {
  EstadoArchivo, estaCerrado, estaFueraDeLinea, sePuedeDescargar,
} from './archivo.entity';

const TODOS: EstadoArchivo[] = ['EN_CURSO', 'COMPLETO', 'FALLIDO', 'ARCHIVADO', 'EN_CUSTODIA'];

/** Mapea cada estado con una pregunta, para que el fallo diga CUÁL se rompió. */
const porEstado = (f: (e: EstadoArchivo) => boolean): Record<string, boolean> =>
  Object.fromEntries(TODOS.map((e) => [e, f(e)]));

/**
 * La política es que NADA se borra nunca: lo que cambia es DÓNDE están los
 * bytes. Estas pruebas fijan esa política donde el código la aplica, porque la
 * forma de romperla sin darse cuenta es añadir un quinto sitio y olvidar una
 * de las dos preguntas.
 */
describe('estados de un archivo', () => {
  it('solo se puede descargar lo que está en línea', () => {
    // ARCHIVADO cuenta como «en línea»: vive en el bucket y Falcon lo sirve
    // igual. EN_CUSTODIA está en la NAS y hay que pedirlo.
    expect(porEstado(sePuedeDescargar)).toEqual({
      EN_CURSO: true, COMPLETO: true, ARCHIVADO: true,
      FALLIDO: false, EN_CUSTODIA: false,
    });
  });

  it('EN_CUSTODIA es el único estado fuera de línea', () => {
    // FALLIDO no lo es: ese archivo nunca existió entero, y mandar al
    // administrador a buscarlo en la NAS sería mandarlo a por nada.
    expect(porEstado(estaFueraDeLinea)).toEqual({
      EN_CURSO: false, COMPLETO: false, ARCHIVADO: false,
      FALLIDO: false, EN_CUSTODIA: true,
    });
  });

  it('ningún estado es a la vez descargable y fuera de línea', () => {
    // Si lo fuera, el controlador tomaría un camino y la pantalla el otro, y
    // el operador vería una descarga rota sin ninguna explicación.
    const ambos = TODOS.filter((e) => sePuedeDescargar(e) && estaFueraDeLinea(e));
    expect(ambos).toEqual([]);
  });

  it('todo estado está contemplado: o se descarga, o se pide, o está roto', () => {
    const huerfanos = TODOS.filter(
      (e) => !sePuedeDescargar(e) && !estaFueraDeLinea(e) && e !== 'FALLIDO');
    expect(huerfanos).toEqual([]);
  });

  it('una grabación en custodia está cerrada: no admite más trozos', () => {
    expect(estaCerrado('EN_CUSTODIA')).toBe(true);
  });
});
