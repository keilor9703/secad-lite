import { EstadoCiudadano, hayQuePedirToque, textoDelToque } from './permisos-ciudadano';

const base: EstadoCiudadano = {
  audioBloqueado: false, ubicacionActiva: false,
  ubicacionDenegada: false, plazoUbicacionCumplido: false,
};
const con = (x: Partial<EstadoCiudadano>): EstadoCiudadano => ({ ...base, ...x });

/**
 * Cuándo se le pone un aviso delante a alguien que está pidiendo auxilio.
 * Ponerlo de más estorba; no ponerlo deja la llamada muda o sin ubicación y
 * sin que nadie sepa por qué — que es lo que pasaba en iPhone.
 */
describe('hayQuePedirToque', () => {
  it('si el audio está bloqueado, se pide YA: no oír al operador es lo grave', () => {
    expect(hayQuePedirToque(con({ audioBloqueado: true }))).toBeTrue();
  });

  it('no se pide por la ubicación antes de que venza el plazo', () => {
    // Un GPS frío tarda. Preguntar a los dos segundos es estorbar.
    expect(hayQuePedirToque(con({ plazoUbicacionCumplido: false }))).toBeFalse();
  });

  it('vencido el plazo sin posición, sí se pide', () => {
    expect(hayQuePedirToque(con({ plazoUbicacionCumplido: true }))).toBeTrue();
  });

  it('si el ciudadano NEGÓ la ubicación no se le insiste', () => {
    expect(hayQuePedirToque(con({ ubicacionDenegada: true, plazoUbicacionCumplido: true }))).toBeFalse();
  });

  it('con la ubicación ya llegando y el audio sonando, no se pide nada', () => {
    expect(hayQuePedirToque(con({ ubicacionActiva: true, plazoUbicacionCumplido: true }))).toBeFalse();
  });

  it('negar la ubicación NO silencia el aviso del audio: son cosas distintas', () => {
    expect(hayQuePedirToque(con({ audioBloqueado: true, ubicacionDenegada: true }))).toBeTrue();
  });
});

describe('textoDelToque', () => {
  it('nombra las dos cosas cuando faltan las dos', () => {
    const t = textoDelToque(con({ audioBloqueado: true, plazoUbicacionCumplido: true }));
    expect(t).toContain('escuchar');
    expect(t).toContain('ubicación');
  });

  it('solo el sonido cuando la ubicación ya llega', () => {
    const t = textoDelToque(con({ audioBloqueado: true, ubicacionActiva: true }));
    expect(t).toContain('escuchar');
    expect(t).not.toContain('ubicación');
  });

  it('solo la ubicación cuando el sonido ya suena', () => {
    const t = textoDelToque(con({ plazoUbicacionCumplido: true }));
    expect(t).toContain('ubicación');
    expect(t).not.toContain('escuchar');
  });
});
