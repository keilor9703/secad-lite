import { BuscadorAcotable, Candidato, RADIO_SESGO_METROS, acotarBuscador, evaluarCandidato, metrosEntre, pareceNomenclaturaColombiana } from './direccion-precision';

const en = (lat: number, lng: number, extra: Partial<Candidato> = {}): Candidato => ({ lat, lng, ...extra });

/**
 * El veredicto solo habla de la CALIDAD del punto.
 *
 * Aquí había una comparación contra el municipio del caso que rechazaba —y
 * después advertía— cuando la dirección caía fuera. Se quitó entera: la
 * búsqueda es libre y el municipio sale de la dirección encontrada. Estas
 * pruebas existen sobre todo para que no vuelva por descuido.
 */
describe('evaluarCandidato', () => {
  it('una dirección exacta pasa sin ruido', () => {
    expect(evaluarCandidato(en(6.172, -75.612, { tipoUbicacion: 'ROOFTOP' }))).toEqual({ aceptar: true, aviso: '' });
  });

  it('un punto en la otra punta del país tampoco dice nada del municipio', () => {
    // Barranquilla buscada desde una central de Itagüí: el operador sabrá por
    // qué lo hizo. Lo único que se mira es si el punto es de fiar.
    const v = evaluarCandidato(en(10.96, -74.80, { tipoUbicacion: 'ROOFTOP' }));
    expect(v).toEqual({ aceptar: true, aviso: '' });
  });

  it('nunca rechaza, pase lo que pase', () => {
    for (const c of [
      en(10.96, -74.80),
      en(6.172, -75.612, { tipoUbicacion: 'APPROXIMATE' }),
      en(6.172, -75.612, { coincidenciaParcial: true }),
    ]) {
      expect(evaluarCandidato(c).aceptar).withContext(JSON.stringify(c)).toBeTrue();
    }
  });

  it('ningún aviso menciona municipios', () => {
    // La regresión concreta que hay que impedir: que vuelva a aparecer
    // «esta dirección no está en …» por la puerta de atrás.
    for (const c of [
      en(10.96, -74.80),
      en(6.172, -75.612, { tipoUbicacion: 'APPROXIMATE' }),
      en(6.172, -75.612, { coincidenciaParcial: true }),
    ]) {
      expect(evaluarCandidato(c).aviso).not.toMatch(/no est[áa] en|municipio|qued[óo] en/i);
    }
  });

  it('un resultado APPROXIMATE se acepta advirtiendo: es un centro, no un portal', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { tipoUbicacion: 'APPROXIMATE' }));
    expect(v.aceptar).toBeTrue();
    expect(v.aviso).toContain('aproximada');
  });

  it('una coincidencia parcial también se advierte', () => {
    const v = evaluarCandidato(en(6.172, -75.612, { coincidenciaParcial: true }));
    expect(v.aceptar).toBeTrue();
    expect(v.aviso).toContain('más parecida');
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

/*
 * Aquí vivía «lo rural no debe salir advertido siempre»: un escape para que un
 * corregimiento (San Antonio de Prado, de Medellín) no se advirtiera como si
 * fuera otro municipio. Sobra desde que no hay ninguna advertencia de
 * municipio — lo cubre, más fuerte, «ningún aviso menciona municipios».
 */

describe('acotarBuscador', () => {
  const retiro = { lat: 6.0597, lng: -75.5047, recuadro: { sur: 5.9833, norte: 6.1167, oeste: -75.5833, este: -75.4333 } };

  it('sesga con el recuadro del municipio', () => {
    const el: BuscadorAcotable = {};
    acotarBuscador(el, retiro);
    expect(el.locationBias).toEqual({ south: 5.9833, north: 6.1167, west: -75.5833, east: -75.4333 });
  });

  it('NUNCA restringe: un límite duro deja el desplegable vacío sin decir por qué', () => {
    const el: BuscadorAcotable = {};
    acotarBuscador(el, retiro);
    expect(el.locationRestriction).toBeNull();
  });

  it('deshace una restricción que hubiera quedado puesta antes', () => {
    const el: BuscadorAcotable = { locationRestriction: { south: 6, north: 6.1, west: -75.6, east: -75.5 } };
    acotarBuscador(el, retiro);
    expect(el.locationRestriction).toBeNull();
  });

  it('sin recuadro cae al círculo, que es sesgo igualmente', () => {
    const el: BuscadorAcotable = {};
    acotarBuscador(el, { lat: 6.17, lng: -75.61, recuadro: null });
    expect(el.locationBias).toEqual({ center: { lat: 6.17, lng: -75.61 }, radius: RADIO_SESGO_METROS });
    expect(el.locationRestriction).toBeNull();
  });

  it('sin municipio no toca nada: mejor el sesgo anterior que ninguno', () => {
    const el: BuscadorAcotable = { locationBias: 'lo de antes' };
    acotarBuscador(el, null);
    expect(el.locationBias).toBe('lo de antes');
  });

  it('el sesgo del encuadre es el recuadro visible, y sigue siendo sesgo', () => {
    // Lo que hace que la búsqueda sea libre: no hay límite, solo preferencia
    // por lo que se está viendo. Mover el mapa cambia lo que sale primero.
    const el: BuscadorAcotable = {};
    acotarBuscador(el, { lat: 6.07, lng: -75.50, recuadro: { sur: 6.0, norte: 6.14, oeste: -75.58, este: -75.42 } });
    expect(el.locationBias).toEqual({ south: 6.0, north: 6.14, west: -75.58, east: -75.42 });
    expect(el.locationRestriction).toBeNull();
  });
});
