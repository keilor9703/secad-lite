import { Candidato, Recuadro, dentroDelRecuadro, evaluarCandidato } from './direccion-precision';

/**
 * El caso que motivó esto: buscar una dirección desde Itagüí y que el punto
 * cayera en otro municipio, sin que nadie lo notara. El recuadro es el de
 * Itagüí (Antioquia) según el catálogo.
 */
const ITAGUI: Recuadro = { sur: 6.129, norte: 6.199, oeste: -75.653, este: -75.580 };
const en = (lat: number, lng: number, extra: Partial<Candidato> = {}): Candidato => ({ lat, lng, ...extra });

describe('dentroDelRecuadro', () => {
  it('un punto del centro de Itagüí está dentro', () => {
    expect(dentroDelRecuadro(6.172, -75.612, ITAGUI)).toBe(true);
  });

  it('Barranquilla no', () => {
    expect(dentroDelRecuadro(10.96, -74.80, ITAGUI)).toBe(false);
  });

  it('Medellín centro tampoco: es el vecino, y es el error más fácil de cometer', () => {
    expect(dentroDelRecuadro(6.2518, -75.5636, ITAGUI)).toBe(false);
  });

  it('pero una dirección justo en el límite sí, por el margen de cortesía', () => {
    // El recuadro es un rectángulo sobre una frontera que no lo es.
    expect(dentroDelRecuadro(ITAGUI.norte + 0.005, -75.61, ITAGUI)).toBe(true);
  });
});

describe('evaluarCandidato', () => {
  it('una dirección del municipio, exacta, pasa sin ruido', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { tipoUbicacion: 'ROOFTOP' }), 'Itagüí', ITAGUI);
    expect(v).toEqual({ aceptar: true, aviso: '' });
  });

  it('fuera del municipio se RECHAZA: el punto no se mueve', () => {
    // Es el que manda una patrulla a otra ciudad. No se acepta ni advertido.
    const v = evaluarCandidato(en(10.96, -74.80, { municipioResuelto: 'Barranquilla' }), 'Itagüí', ITAGUI);
    expect(v.aceptar).toBe(false);
    expect(v.aviso).toContain('no está en Itagüí');
    expect(v.aviso).withContext('se dice dónde quedó, para que el operador entienda').toContain('Barranquilla');
  });

  it('sin recuadro conocido no se puede rechazar por ubicación', () => {
    // Inventar un límite sería peor que no tenerlo: se acepta.
    const v = evaluarCandidato(en(10.96, -74.80), 'Itagüí', null);
    expect(v.aceptar).toBe(true);
  });

  it('dentro pero con otro nombre de municipio: se acepta y se avisa', () => {
    // Corregimientos y nombres alternos del mismo sitio. Lo que NO se hace es
    // cambiarle el municipio al caso sin decirlo.
    const v = evaluarCandidato(en(6.172, -75.612, { municipioResuelto: 'Sabaneta' }), 'Itagüí', ITAGUI);
    expect(v.aceptar).toBe(true);
    expect(v.aviso).toContain('Sabaneta');
  });

  it('el nombre se compara sin acentos ni mayúsculas', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { municipioResuelto: 'ITAGUI' }), 'Itagüí', ITAGUI);
    expect(v.aviso).toBe('');
  });

  it('un resultado APPROXIMATE se acepta advirtiendo: es un centro, no un portal', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { tipoUbicacion: 'APPROXIMATE' }), 'Itagüí', ITAGUI);
    expect(v.aceptar).toBe(true);
    expect(v.aviso).toContain('aproximada');
  });

  it('una coincidencia parcial también se advierte', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { coincidenciaParcial: true }), 'Itagüí', ITAGUI);
    expect(v.aceptar).toBe(true);
    expect(v.aviso).toContain('más parecida');
  });

  it('estar fuera manda sobre todo lo demás', () => {
    // Un resultado exacto y del municipio correcto según Google, pero en otras
    // coordenadas, sigue siendo un punto en otra parte.
    const v = evaluarCandidato(
      en(10.96, -74.80, { tipoUbicacion: 'ROOFTOP', municipioResuelto: 'Itagüí' }), 'Itagüí', ITAGUI);
    expect(v.aceptar).toBe(false);
  });
});
