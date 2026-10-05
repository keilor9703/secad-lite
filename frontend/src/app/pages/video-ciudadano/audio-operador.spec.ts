import { ReproductorAudio, intentarSonar } from './audio-operador';

/**
 * El fallo que esto arregla: en iPhone con Safari, el ciudadano NO oía al
 * operador. La pista llegaba bien por WebRTC —el operador sí oía al
 * ciudadano— y se quedaba en un elemento de medios pausado, en silencio, sin
 * error en ninguna parte y sin nada en pantalla que lo dijera.
 *
 * Lo que se prueba aquí es que nunca más pueda quedarse callado sin que nadie
 * se entere: toda ruta devuelve si SUENA o no, y el componente enciende el
 * aviso con esa respuesta.
 */

/** Un elemento de medios de mentira. `play` falla hasta que se le diga que no. */
function elementoFalso(opciones: { bloqueado?: boolean } = {}) {
  const el = {
    srcObject: null as MediaProvider | null,
    bloqueado: opciones.bloqueado ?? false,
    pausas: 0,
    intentos: 0,
    play() {
      this.intentos++;
      return this.bloqueado ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
    },
    pause() { this.pausas++; },
  };
  return el;
}

const pista = () => ({ id: 'voz-operador' }) as unknown as MediaStream;

describe('intentarSonar', () => {
  it('conecta la pista y la hace sonar', async () => {
    const el = elementoFalso();
    const p = pista();
    expect(await intentarSonar(el, p)).toBeTrue();
    expect(el.srcObject).withContext('la pista quedó conectada').toBe(p);
    expect(el.intentos).withContext('se llamó a play(); no basta el atributo autoplay').toBe(1);
  });

  it('si el navegador lo RECHAZA, lo dice: ese es el caso de iOS', async () => {
    // Safari bloquea el sonido mientras el ciudadano no haya tocado la página.
    // Antes esto se tragaba en silencio y la llamada seguía muda.
    const el = elementoFalso({ bloqueado: true });
    expect(await intentarSonar(el, pista())).toBeFalse();
  });

  it('tras el toque del ciudadano, el mismo elemento ya suena', async () => {
    const el = elementoFalso({ bloqueado: true });
    const p = pista();
    expect(await intentarSonar(el, p)).toBeFalse();
    el.bloqueado = false;                      // el gesto desbloquea
    expect(await intentarSonar(el, p, { reiniciar: true })).toBeTrue();
  });

  it('«reiniciar» hace pause() antes de play(): el remedio del atasco de Safari', async () => {
    const el = elementoFalso();
    await intentarSonar(el, pista(), { reiniciar: true });
    expect(el.pausas).toBe(1);
  });

  it('sin «reiniciar» NO se pausa: fuera de un gesto el play() posterior se rechazaría', async () => {
    const el = elementoFalso();
    await intentarSonar(el, pista());
    expect(el.pausas).toBe(0);
  });

  it('no reasigna la misma pista: reasignarla reinicia el elemento en algunos navegadores', async () => {
    const el = elementoFalso();
    const p = pista();
    await intentarSonar(el, p);
    let asignaciones = 0;
    Object.defineProperty(el, 'srcObject', {
      get: () => p,
      set: () => { asignaciones++; },
    });
    await intentarSonar(el, p);
    expect(asignaciones).toBe(0);
  });

  it('sin elemento o sin pista no suena, y lo dice en vez de reventar', async () => {
    expect(await intentarSonar(null, pista())).toBeFalse();
    expect(await intentarSonar(undefined, pista())).toBeFalse();
    expect(await intentarSonar(elementoFalso(), null)).toBeFalse();
  });

  it('funciona con un elemento que no sepa pausar', async () => {
    // El `pause` es opcional en la interfaz; pedirlo no puede romper nada.
    const el: ReproductorAudio = { srcObject: null, play: () => Promise.resolve() };
    expect(await intentarSonar(el, pista(), { reiniciar: true })).toBeTrue();
  });
});
