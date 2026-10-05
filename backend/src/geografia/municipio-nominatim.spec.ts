import {
  HitNominatim, LADO_MINIMO_GRADOS, consultasPara, elegirMunicipio, normalizar,
} from './municipio-nominatim';

/**
 * El caso real: pedir «Retiro, Antioquia, Colombia» y que Nominatim ponga de
 * primero un lugar llamado Retiro en la zona de Urrao, a 130 km del municipio.
 * Con `limit=1` eso era lo que se guardaba.
 */
const retiroDeUrrao: HitNominatim = {
  lat: '6.3156', lon: '-76.1372',
  class: 'place', type: 'hamlet',
  display_name: 'Retiro, Urrao, Suroeste, Antioquia, Colombia',
  boundingbox: ['6.2956', '6.3356', '-76.1572', '-76.1172'],
  address: { state: 'Antioquia', country_code: 'co' },
};

const elRetiroMunicipio: HitNominatim = {
  lat: '6.0597', lon: '-75.5047',
  class: 'boundary', type: 'administrative',
  display_name: 'El Retiro, Oriente, Antioquia, Colombia',
  boundingbox: ['5.9833', '6.1167', '-75.5833', '-75.4333'],
  address: { state: 'Antioquia', country_code: 'co' },
};

describe('elegirMunicipio', () => {
  it('descarta el caserío y elige el límite administrativo, aunque venga después', () => {
    const u = elegirMunicipio([retiroDeUrrao, elRetiroMunicipio], 'Retiro', 'Antioquia');
    expect(u).not.toBeNull();
    expect(u!.lat).toBeCloseTo(6.0597, 4);
    expect(u!.recuadro).toEqual({ sur: 5.9833, norte: 6.1167, oeste: -75.5833, este: -75.4333 });
  });

  it('tolera el artículo que el DANE omite y OSM sí usa', () => {
    expect(elegirMunicipio([elRetiroMunicipio], 'Retiro', 'Antioquia')).not.toBeNull();
    expect(elegirMunicipio([elRetiroMunicipio], 'El Retiro', 'Antioquia')).not.toBeNull();
  });

  it('sin ningún límite administrativo devuelve null, no el caserío', () => {
    expect(elegirMunicipio([retiroDeUrrao], 'Retiro', 'Antioquia')).toBeNull();
  });

  it('descarta un municipio homónimo de otro departamento', () => {
    const retiroOtroDepto: HitNominatim = {
      ...elRetiroMunicipio,
      display_name: 'El Retiro, Magdalena, Colombia',
      address: { state: 'Magdalena', country_code: 'co' },
    };
    expect(elegirMunicipio([retiroOtroDepto], 'Retiro', 'Antioquia')).toBeNull();
  });

  it('descarta un límite administrativo que se llama distinto', () => {
    const vecino: HitNominatim = { ...elRetiroMunicipio, display_name: 'Envigado, Antioquia, Colombia' };
    expect(elegirMunicipio([vecino], 'Retiro', 'Antioquia')).toBeNull();
  });

  it('acepta el municipio pero SIN recuadro si el rectángulo es implausible', () => {
    const diminuto: HitNominatim = {
      ...elRetiroMunicipio,
      boundingbox: ['6.0590', '6.0600', '-75.5050', '-75.5040'],   // ~100 m
    };
    const u = elegirMunicipio([diminuto], 'Retiro', 'Antioquia');
    expect(u).not.toBeNull();
    expect(u!.recuadro).toBeNull();
  });

  it('también descarta el recuadro de un departamento entero', () => {
    const depto: HitNominatim = { ...elRetiroMunicipio, boundingbox: ['5.0', '9.0', '-77.0', '-73.0'] };
    expect(elegirMunicipio([depto], 'Retiro', 'Antioquia')!.recuadro).toBeNull();
  });

  it('un recuadro al revés no se usa', () => {
    const alReves: HitNominatim = { ...elRetiroMunicipio, boundingbox: ['6.1167', '5.9833', '-75.4333', '-75.5833'] };
    expect(elegirMunicipio([alReves], 'Retiro', 'Antioquia')!.recuadro).toBeNull();
  });

  it('el piso deja pasar al municipio más pequeño del país', () => {
    // Sabaneta, 15 km²: ~0,04° de lado. Si el piso lo descartara, sobraría.
    const sabaneta: HitNominatim = {
      lat: '6.1515', lon: '-75.6166',
      class: 'boundary', type: 'administrative',
      display_name: 'Sabaneta, Antioquia, Colombia',
      boundingbox: ['6.1300', '6.1700', '-75.6400', '-75.5900'],
      address: { state: 'Antioquia', country_code: 'co' },
    };
    const u = elegirMunicipio([sabaneta], 'Sabaneta', 'Antioquia');
    expect(u!.recuadro).not.toBeNull();
    expect(0.04).toBeGreaterThan(LADO_MINIMO_GRADOS);
  });

  it('lista vacía o nula no revienta', () => {
    expect(elegirMunicipio([], 'Retiro', 'Antioquia')).toBeNull();
    expect(elegirMunicipio(null, 'Retiro', 'Antioquia')).toBeNull();
  });
});

describe('consultasPara', () => {
  it('prueba también con el artículo cuando el nombre no lo trae', () => {
    expect(consultasPara('Retiro', 'Antioquia')).toEqual([
      'Retiro, Antioquia, Colombia',
      'El Retiro, Antioquia, Colombia',
    ]);
  });

  it('no duplica el artículo si el nombre ya lo tiene', () => {
    expect(consultasPara('El Peñol', 'Antioquia')).toEqual(['El Peñol, Antioquia, Colombia']);
  });
});

describe('normalizar', () => {
  it('quita acentos, mayúsculas y puntuación', () => {
    expect(normalizar('Bogotá, D.C.')).toBe('bogota d c');
    expect(normalizar('  EL  PEÑOL ')).toBe('el penol');
  });

  it('la ñ se reduce a n, igual en los dos lados de la comparación', () => {
    const penol: HitNominatim = {
      lat: '6.2186', lon: '-75.2434',
      class: 'boundary', type: 'administrative',
      display_name: 'El Penol, Antioquia, Colombia',   // sin la ñ, como a veces llega
      boundingbox: ['6.1500', '6.3000', '-75.3200', '-75.1800'],
      address: { state: 'Antioquia', country_code: 'co' },
    };
    expect(elegirMunicipio([penol], 'El Peñol', 'Antioquia')).not.toBeNull();
  });
});
