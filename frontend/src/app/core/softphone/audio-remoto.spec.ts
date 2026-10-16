import { engancharAudioRemoto, soltarAudioRemoto } from './audio-remoto';

/** Una pista de audio de verdad, sin pedir el micrófono. */
const pistaDeAudio = (): MediaStreamTrack => {
  const ctx = new AudioContext();
  const destino = ctx.createMediaStreamDestination();
  return destino.stream.getAudioTracks()[0];
};

/**
 * El enganche del audio remoto.
 *
 * Esto es lo que se rompió en producción —al operador lo oían y él no oía
 * nada—, así que lo que se protege es exactamente eso: que el flujo llegue al
 * elemento, y que el diagnóstico de «no hay audio» no mienta en ninguno de
 * los dos sentidos.
 */
describe('engancharAudioRemoto', () => {
  let el: HTMLAudioElement;

  beforeEach(() => { el = document.createElement('audio'); });

  it('le pone el flujo al elemento y cuenta las pistas', () => {
    const flujo = new MediaStream([pistaDeAudio()]);

    const pistas = engancharAudioRemoto(el, flujo, () => undefined);

    expect(pistas).toBe(1);
    expect(el.srcObject).toBe(flujo);
  });

  it('lo desmutea: un elemento mudo es silencio con la llamada en pie', () => {
    el.muted = true;

    engancharAudioRemoto(el, new MediaStream([pistaDeAudio()]), () => undefined);

    expect(el.muted).toBeFalse();
  });

  it('sin pistas todavía, devuelve cero', () => {
    expect(engancharAudioRemoto(el, new MediaStream(), () => undefined)).toBe(0);
  });

  it('y se corrige cuando la pista llega después', () => {
    // SIP.js lo documenta: el flujo remoto nace sin pistas. Si el aviso de
    // «sin audio» no se retracta, la próxima vez nadie le cree.
    const flujo = new MediaStream();
    const avisos: number[] = [];

    engancharAudioRemoto(el, flujo, (n) => avisos.push(n));
    const pista = pistaDeAudio();
    flujo.addTrack(pista);
    flujo.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track: pista }));

    expect(avisos).toEqual([1]);
  });

  it('si ya había audio, no se queda esperando nada', () => {
    const flujo = new MediaStream([pistaDeAudio()]);
    const avisos: number[] = [];

    engancharAudioRemoto(el, flujo, (n) => avisos.push(n));
    flujo.dispatchEvent(new MediaStreamTrackEvent('addtrack', { track: pistaDeAudio() }));

    expect(avisos).toEqual([]);
  });

  it('sin elemento o sin flujo, no revienta y dice que no hay audio', () => {
    expect(engancharAudioRemoto(undefined, new MediaStream(), () => undefined)).toBe(0);
    expect(engancharAudioRemoto(el, undefined, () => undefined)).toBe(0);
  });

  it('soltarlo deja el elemento libre para la siguiente llamada', () => {
    engancharAudioRemoto(el, new MediaStream([pistaDeAudio()]), () => undefined);

    soltarAudioRemoto(el);

    expect(el.srcObject).toBeNull();
  });
});
