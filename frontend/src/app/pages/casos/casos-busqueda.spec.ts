import { Caso } from '../../core/models';
import { coincideBusqueda } from './casos-busqueda';

/** Caso de ejemplo con todos los campos que mira la barra de búsqueda. */
const CASO = {
  id: '7f3a9c21-4b8e-4d6f-9a0c-15e2b7d84f3a',
  llamadaId: 'c0ffee12-3456-4789-abcd-ef0123456789',
  titulo: 'Riña en vía pública',
  ciudadano: 'María Gómez',
  direccion: 'Carrera 45 # 12-30',
  barrio: 'El Centro',
  codigoCaso: 'C-104',
  agencia: 'Policía Nacional',
} as Caso;

/** Como la escribe el operador: la pantalla recorta y pasa a minúscula. */
const buscar = (q: string, c: Caso = CASO) => coincideBusqueda(c, q.trim().toLowerCase());

describe('coincideBusqueda', () => {
  it('encuentra por motivo, ciudadano, dirección, barrio, código y agencia', () => {
    expect(buscar('riña')).toBe(true);
    expect(buscar('maría')).toBe(true);
    expect(buscar('Carrera 45')).toBe(true);
    expect(buscar('centro')).toBe(true);
    expect(buscar('c-104')).toBe(true);
    expect(buscar('policía')).toBe(true);
  });

  it('sin texto devuelve todo, y lo que no está no coincide', () => {
    expect(buscar('')).toBe(true);
    expect(buscar('   ')).toBe(true);
    expect(buscar('bogotá')).toBe(false);
  });

  it('encuentra por el id del caso, entero o por un trozo', () => {
    expect(buscar(CASO.id)).toBe(true);
    expect(buscar(CASO.id.toUpperCase())).toBe(true);
    expect(buscar('7f3a9c21')).toBe(true);
    expect(buscar('15e2b7d84f3a')).toBe(true);
  });

  it('encuentra por el id de la llamada', () => {
    expect(buscar('c0ffee12-3456-4789-abcd-ef0123456789')).toBe(true);
    expect(buscar('ef0123456789')).toBe(true);
  });

  it('no revienta con un caso sin id de llamada', () => {
    const sinLlamada = { ...CASO, llamadaId: null } as Caso;
    expect(buscar('7f3a9c21', sinLlamada)).toBe(true);
    expect(buscar('ef0123456789', sinLlamada)).toBe(false);
  });

  // Lo que hace útil la barra no es solo lo que encuentra, sino lo que NO
  // devuelve: un UUID contiene casi cualquier combinación corta de dígitos y
  // letras a–f, así que sin un mínimo de caracteres una búsqueda de dos
  // letras traería medio listado.
  it('no deja que los UUID contaminen una búsqueda corta', () => {
    expect(buscar('ab')).toBe(false);
    expect(buscar('4b8e')).toBe(false);   // sí está dentro del id, pero son 4
    expect(buscar('9a0c1')).toBe(false);  // 5
    expect(buscar('9a0c-1')).toBe(true);  // 6: ya busca en el id
  });
});
