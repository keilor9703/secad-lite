import { Candidato, Recuadro, dentroDelRecuadro, evaluarCandidato, metrosEntre, pareceNomenclaturaColombiana } from './direccion-precision';

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

/**
 * Lo rural: veredas y corregimientos.
 *
 * El motor de nomenclatura colombiana resuelve cruces de vías. Una vereda no
 * tiene cruce que buscar: es un lugar con nombre, y ahí Google es mucho mejor
 * que buscar por texto en OpenStreetMap. El portero tiene que mandarlas a
 * Google, no al motor.
 */
describe('pareceNomenclaturaColombiana', () => {
  it('reconoce la nomenclatura urbana, escrita como la escribe la gente', () => {
    expect(pareceNomenclaturaColombiana('Calle 53 # 52-35')).toBe(true);
    expect(pareceNomenclaturaColombiana('Cra 7 No 45-12')).toBe(true);
    expect(pareceNomenclaturaColombiana('KR 68 #24-30 Sur')).toBe(true);
    expect(pareceNomenclaturaColombiana('diagonal 40a nro 12-05')).toBe(true);
  });

  it('NO manda las veredas al motor de nomenclatura', () => {
    expect(pareceNomenclaturaColombiana('Vereda El Pedregal')).toBe(false);
    expect(pareceNomenclaturaColombiana('Corregimiento San Antonio de Prado')).toBe(false);
    expect(pareceNomenclaturaColombiana('Vereda La Doctora sector 2')).toBe(false);
    expect(pareceNomenclaturaColombiana('Km 5 vía Las Palmas')).toBe(false);
  });

  it('una dirección rural CON forma de nomenclatura también va a Google', () => {
    // Estos son los que de verdad ejercitan la guarda: tienen cruce, así que
    // sin ella pasarían al motor. Pero en una vereda no hay retícula: el motor
    // buscaría esa esquina en la zona urbana y devolvería un punto de otro
    // lado del municipio. (Lo descubrí saboteando la guarda y viendo que la
    // prueba seguía en verde: los casos que tenía no la tocaban.)
    expect(pareceNomenclaturaColombiana('Vereda La Doctora Calle 10 # 5-20')).toBe(false);
    expect(pareceNomenclaturaColombiana('Corregimiento Santa Elena Carrera 20 # 30-15')).toBe(false);
    expect(pareceNomenclaturaColombiana('Km 5 vía Las Palmas Cra 2 # 3-4')).toBe(false);
  });

  it('ni los puntos de interés, que es donde Google gana', () => {
    expect(pareceNomenclaturaColombiana('Centro Comercial Viva Envigado')).toBe(false);
    expect(pareceNomenclaturaColombiana('Hospital San Rafael')).toBe(false);
    expect(pareceNomenclaturaColombiana('Parque principal')).toBe(false);
  });

  it('una vía SIN cruce tampoco: sin esquina, el motor no aporta nada', () => {
    expect(pareceNomenclaturaColombiana('Calle 53')).toBe(false);
    expect(pareceNomenclaturaColombiana('Carrera 52')).toBe(false);
  });
});

describe('metrosEntre', () => {
  it('mide distancias cortas con sentido', () => {
    // Una cuadra típica del centro de Medellín, ~100 m.
    expect(metrosEntre(6.2518, -75.5636, 6.2527, -75.5636)).toBeGreaterThan(80);
    expect(metrosEntre(6.2518, -75.5636, 6.2527, -75.5636)).toBeLessThan(120);
  });

  it('y el mismo punto da cero', () => {
    expect(metrosEntre(6.2518, -75.5636, 6.2518, -75.5636)).toBe(0);
  });
});

describe('evaluarCandidato — lo rural no debe salir advertido siempre', () => {
  it('un corregimiento NO se advierte como otro municipio', () => {
    // Google devuelve «San Antonio de Prado» como localidad; es un
    // corregimiento de Medellín, no otro municipio. Sin esto, cada búsqueda
    // rural salía advertida, y una advertencia que aparece siempre no se lee.
    const v = evaluarCandidato(
      en(6.172, -75.612, { municipioResuelto: 'San Antonio de Prado' }),
      'Itagüí', ITAGUI,
      (n) => ['Medellín', 'Sabaneta', 'Envigado'].includes(n),
    );
    expect(v.aceptar).toBe(true);
    expect(v.aviso).withContext('sin ruido').toBe('');
  });

  it('pero un municipio vecino de verdad sí', () => {
    const v = evaluarCandidato(
      en(6.172, -75.612, { municipioResuelto: 'Sabaneta' }),
      'Itagüí', ITAGUI,
      (n) => ['Medellín', 'Sabaneta', 'Envigado'].includes(n),
    );
    expect(v.aviso).toContain('Sabaneta');
  });
});
