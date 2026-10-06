import {
  guardarIceFirmados,
  olvidarIceFirmados,
  hayIceFirmadosVigentes,
  iceServers,
} from './config-runtime';

/**
 * Lo que se protege aquí es la cadena de respaldo. Este cambio se despliega en
 * un sistema de emergencias que ya está en producción: si el backend todavía
 * no firma credenciales, o si la petición falla, la videollamada tiene que
 * seguir funcionando con la credencial estática de siempre.
 */
describe('servidores ICE', () => {
  const FIRMADOS: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['turn:turn.ejemplo:3478'], username: '1700000000:sesion', credential: 'firma' },
  ];
  const enSegundos = (ms: number) => Math.floor(ms / 1000);

  beforeEach(() => olvidarIceFirmados());
  afterAll(() => olvidarIceFirmados());

  it('sin credenciales firmadas cae al respaldo y nunca devuelve vacío', () => {
    expect(hayIceFirmadosVigentes()).toBe(false);
    const servers = iceServers();
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0].urls).toBeTruthy();
  });

  it('usa las firmadas cuando están vigentes', () => {
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(true);
    expect(iceServers()).toBe(FIRMADOS);
  });

  it('vuelve al respaldo cuando vencen', () => {
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) - 10);
    expect(hayIceFirmadosVigentes()).toBe(false);
    expect(iceServers()).not.toBe(FIRMADOS);
  });

  it('descarta una credencial a punto de vencer', () => {
    // Si vence a mitad del intercambio ICE, la llamada se queda sin relevo
    // justo cuando lo necesita. Treinta segundos no alcanzan.
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) + 30);
    expect(hayIceFirmadosVigentes()).toBe(false);
  });

  it('una respuesta vacía del backend no borra lo que ya había', () => {
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) + 3600);
    guardarIceFirmados(undefined, 0);
    guardarIceFirmados([], 0);
    expect(iceServers()).toBe(FIRMADOS);
  });

  it('sin vencimiento declarado se les da un margen corto, no eterno', () => {
    guardarIceFirmados(FIRMADOS);
    expect(hayIceFirmadosVigentes()).toBe(true);
    expect(hayIceFirmadosVigentes(Date.now() + 10 * 60_000)).toBe(false);
  });
});
