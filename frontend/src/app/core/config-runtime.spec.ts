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

  /**
   * La regresión que tumbó la videollamada en producción.
   *
   * Un backend sin TURN_SECRET responde con una lista NO vacía: solo el STUN.
   * Adoptarla dejaba la llamada sin relevo — video en negro y sin audio en
   * toda red con NAT cerrado, y perfecto en WiFi, que es donde se probaba.
   */
  it('una lista de solo STUN NO se adopta como credencial firmada', () => {
    guardarIceFirmados([{ urls: ['stun:stun.l.google.com:19302'] }], enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(false);
  });

  it('una lista de solo STUN no pisa unas credenciales buenas', () => {
    // El caso real: el despachador abre la llamada, el backend firma bien, y
    // una segunda respuesta sin TURN —otro backend, una réplica sin la
    // variable— le borraba el relevo a media llamada.
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) + 3600);
    guardarIceFirmados([{ urls: ['stun:stun.l.google.com:19302'] }], enSegundos(Date.now()) + 3600);
    expect(iceServers()).toBe(FIRMADOS);
  });

  it('tampoco se adopta un TURN sin credencial', () => {
    guardarIceFirmados([
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['turn:turn.ejemplo:3478'] },
    ], enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(false);
  });

  it('tampoco se adopta un TURN con usuario pero sin clave', () => {
    guardarIceFirmados([
      { urls: ['turn:turn.ejemplo:3478'], username: '1700000000:x' },
    ], enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(false);
  });

  it('no confunde un STUN con credencial con un TURN', () => {
    // Defensa contra una respuesta mal formada: lo que decide es el esquema
    // de la URL, no que venga un usuario pegado.
    guardarIceFirmados([
      { urls: ['stun:stun.ejemplo:3478'], username: 'u', credential: 'c' },
    ], enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(false);
  });

  it('sí se adopta una lista con STUN y TURN autenticado', () => {
    guardarIceFirmados(FIRMADOS, enSegundos(Date.now()) + 3600);
    expect(hayIceFirmadosVigentes()).toBe(true);
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
