import { ESPERA_ICE_MS, opcionesMedios } from './transporte-sipjs';
import { ConfigSoftphone } from './transporte-sip';

/**
 * LA ESPERA ANTES DE CONTESTAR.
 *
 * SIP no manda candidatos a cuentagotas: la respuesta SDP sale UNA vez, con
 * los candidatos que haya, así que SIP.js espera a que el navegador termine
 * de recolectarlos. Su tope por defecto es 5000 ms y en producción se
 * agotaba ENTERO en cada llamada: el operador oprimía «Contestar» y la
 * llamada se conectaba cinco o seis segundos después. Que se agote entero
 * significa que la recolección no termina, o sea que algún servidor ICE no
 * contesta; CUÁL no está medido todavía —ver el comentario de
 * `opcionesMedios`, que enumera los candidatos y cómo averiguarlo—.
 *
 * Este número es el que arregla eso, y tiene margen por los dos lados:
 *
 *  - **Por arriba**, tiene que ser bastante menor que los 5000 ms de SIP.js,
 *    o no arregla nada.
 *  - **Por abajo**, no puede ser tan corto que se conteste ANTES de tener el
 *    candidato público (srflx): sin él la central solo recibe direcciones
 *    privadas y la llamada se establece SIN AUDIO, que es peor que lenta.
 */
describe('opciones de medios del softphone', () => {
  const CONFIG: ConfigSoftphone = {
    wss: 'wss://itagui-pbx.falconcad.com.co/ws',
    dominio: 'itagui-pbx.falconcad.com.co',
    usuario: '101',
    extension: '101',
    clave: 'secreta',
  } as ConfigSoftphone;

  it('no espera los 5 segundos por defecto de SIP.js', () => {
    expect(opcionesMedios(CONFIG).iceGatheringTimeout).toBe(ESPERA_ICE_MS);
    expect(ESPERA_ICE_MS).toBeLessThan(5000);
  });

  it('pero deja tiempo de sobra para el candidato público, que es el que da audio', () => {
    // Un ida y vuelta al STUN son decenas de milisegundos; esto deja margen
    // para una resolución de DNS fría y un reintento.
    expect(ESPERA_ICE_MS).toBeGreaterThanOrEqual(1000);
  });

  it('los servidores ICE van DENTRO de peerConnectionConfiguration, donde SIP.js los lee', () => {
    const o = opcionesMedios(CONFIG);
    // Suelto como `iceServers` SIP.js lo ignora sin decir nada, y el síntoma
    // es una llamada establecida y en silencio por los dos lados.
    expect(o.peerConnectionConfiguration.iceServers).toBeDefined();
    expect(Array.isArray(o.peerConnectionConfiguration.iceServers)).toBe(true);
  });

  it('suma los que manda la planta a los de la plataforma, sin descartar ninguno', () => {
    const propios = [{ urls: 'stun:stun.ejemplo.com:3478' }];
    const plataforma = [{ urls: 'turn:turn.falconcad.com.co:3478', username: 'u', credential: 'c' }];
    const o = opcionesMedios({ ...CONFIG, ice: propios } as ConfigSoftphone, () => plataforma);
    expect(o.peerConnectionConfiguration.iceServers).toContain(propios[0]);
    expect(o.peerConnectionConfiguration.iceServers).toContain(plataforma[0]);
  });

  it('cada llamada toma las credenciales VIGENTES, no las de cuando se encendió la barra', () => {
    // Las credenciales de TURN van firmadas con vencimiento, y la barra se
    // queda encendida todo el turno: con un valor fijo, a media jornada el
    // relevo contesta «no autorizado» y el navegador se queda reintentando,
    // que es exactamente el retraso que este archivo intenta evitar.
    let vigentes: RTCIceServer[] = [{ urls: 'turn:uno', username: 'de-la-mañana' }];
    const o = opcionesMedios(CONFIG, () => vigentes);
    expect(o.peerConnectionConfiguration.iceServers).toContain(vigentes[0]);

    vigentes = [{ urls: 'turn:uno', username: 'de-la-tarde' }];
    expect(o.peerConnectionConfiguration.iceServers[0]).toEqual(
      jasmine.objectContaining({ username: 'de-la-tarde' }),
    );
  });
});
