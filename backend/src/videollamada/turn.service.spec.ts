import { ConfigService } from '@nestjs/config';
import { TurnService, separarUrls } from './turn.service';

/** ConfigService mínimo: un mapa, que es todo lo que el servicio le pide. */
const configDe = (valores: Record<string, string>) =>
  ({ get: (k: string) => valores[k] }) as unknown as ConfigService;

describe('TurnService', () => {
  const URLS = 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349';

  describe('separarUrls', () => {
    it('parte por comas y tolera espacios y vacíos', () => {
      expect(separarUrls(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
      expect(separarUrls('')).toEqual([]);
      expect(separarUrls(undefined)).toEqual([]);
    });
  });

  it('firma la credencial cuando hay secreto y urls', () => {
    const s = new TurnService(configDe({ TURN_SECRET: 'abc', TURN_URLS: URLS }));
    expect(s.habilitado).toBe(true);

    const { iceServers, venceEn } = s.obtener('sesion-7');
    expect(iceServers).toHaveLength(2);

    const turn = iceServers[1];
    expect(turn.urls).toEqual([
      'turn:turn.example.com:3478?transport=udp',
      'turns:turn.example.com:5349',
    ]);
    expect(turn.username).toMatch(/^\d+:sesion-7$/);
    expect(turn.credential).toBeTruthy();
    expect(venceEn).toBe(Number(turn.username!.split(':')[0]));
  });

  /**
   * Esta es la garantía que hace que el despliegue sea seguro: si falta la
   * configuración, el backend NO debe inventarse un TURN ni reventar. Devuelve
   * solo STUN y el frontend cae a su respaldo.
   */
  it('sin configuración entrega solo STUN y no falla', () => {
    for (const valores of [
      {},
      { TURN_SECRET: 'abc' },                 // sin urls
      { TURN_URLS: URLS },                    // sin secreto
      { TURN_SECRET: '   ', TURN_URLS: URLS },// secreto en blanco
    ]) {
      const s = new TurnService(configDe(valores as Record<string, string>));
      expect(s.habilitado).toBe(false);

      const { iceServers, venceEn } = s.obtener('x');
      expect(iceServers).toHaveLength(1);
      expect(iceServers[0].urls).toEqual(['stun:stun.l.google.com:19302']);
      expect(iceServers[0].username).toBeUndefined();
      expect(venceEn).toBeUndefined();
    }
  });

  it('nunca entrega el secreto, ni siquiera dentro de la credencial', () => {
    const secreto = 'secreto-que-no-debe-salir';
    const s = new TurnService(configDe({ TURN_SECRET: secreto, TURN_URLS: URLS }));
    expect(JSON.stringify(s.obtener('x'))).not.toContain(secreto);
  });

  it('respeta el STUN propio cuando el despliegue lo configura', () => {
    const s = new TurnService(configDe({ STUN_URLS: 'stun:propio:3478' }));
    expect(s.obtener().iceServers[0].urls).toEqual(['stun:propio:3478']);
  });

  it('acota una vigencia disparatada en vez de aceptarla', () => {
    const s = new TurnService(
      configDe({ TURN_SECRET: 'abc', TURN_URLS: URLS, TURN_TTL_SEGUNDOS: '999999999' }),
    );
    const { venceEn } = s.obtener('x');
    expect(venceEn! - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(24 * 60 * 60);
  });
});
