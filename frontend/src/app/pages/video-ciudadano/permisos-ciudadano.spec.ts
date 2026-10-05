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

import {
  UBICACION_DENEGADA, UBICACION_NO_DISPONIBLE, UBICACION_TARDA, explicarFalloUbicacion,
} from './permisos-ciudadano';

/**
 * El fallo de ubicación era INVISIBLE: no aparecía el punto, el ciudadano no
 * veía nada y el operador tampoco. Nadie podía decir siquiera qué pasó — por
 * eso costó tanto encontrarlo. Lo que se prueba es que ninguna rama se quede
 * muda, y que la de iPhone diga dónde se arregla.
 */
describe('explicarFalloUbicacion', () => {
  it('ninguna rama se queda sin mensaje, ni para el ciudadano ni para el operador', () => {
    for (const c of [UBICACION_DENEGADA, UBICACION_NO_DISPONIBLE, UBICACION_TARDA, 99, undefined]) {
      const f = explicarFalloUbicacion(c);
      expect(f.mensaje).withContext(`código ${c}`).not.toBe('');
      expect(f.paraElOperador).withContext(`código ${c}`).not.toBe('');
    }
  });

  it('denegado explica el ajuste de iOS, no solo «permiso denegado»', () => {
    // En iPhone este código casi nunca es «el ciudadano dijo que no»: es que
    // iOS tiene la localización desactivada para Safari y por eso NO PREGUNTA.
    const f = explicarFalloUbicacion(UBICACION_DENEGADA);
    expect(f.mensaje).toContain('Ajustes');
    expect(f.mensaje).toContain('Safari');
  });

  it('al operador se le dice que pregunte la dirección cuando no va a llegar', () => {
    expect(explicarFalloUbicacion(UBICACION_DENEGADA).paraElOperador).toContain('Pregúntele');
  });

  it('todo fallo es reintentable: en iPhone el ciudadano puede cambiar el ajuste y volver', () => {
    for (const c of [UBICACION_DENEGADA, UBICACION_NO_DISPONIBLE, UBICACION_TARDA, undefined]) {
      expect(explicarFalloUbicacion(c).reintentable).withContext(`código ${c}`).toBeTrue();
    }
  });
});
