/**
 * ¿Se puede confiar en el PUNTO que devolvió el geocodificador?
 *
 * Solo eso. Aquí no se decide si la dirección pertenece al municipio del caso:
 * la búsqueda es libre y el municipio sale de la dirección encontrada, no al
 * revés. Lo que se evalúa es la calidad del punto —aproximado, o una
 * coincidencia parcial— que es justo lo que el operador no puede ver mirando
 * el mapa.
 *
 * Vive aparte del formulario para poder probarlo entero.
 */

/**
 * ¿Vale la pena preguntarle al motor de nomenclatura colombiana?
 *
 * Solo sirve para direcciones URBANAS con cruce: «Calle 53 # 52-35» significa
 * «sobre la Calle 53, a 35 metros de la esquina con la Carrera 52», y el motor
 * busca ese cruce. Es donde Google falla, porque no entiende el `#` y se queda
 * con la vía entera.
 *
 * Pero una VEREDA o un CORREGIMIENTO no tienen nomenclatura: «Vereda El
 * Pedregal» es un lugar con nombre, no un cruce. Ahí el motor no tiene nada que
 * cruzar y caería a una búsqueda por texto en OpenStreetMap, que para lo rural
 * en Colombia es mucho peor que Google. Lo mismo con un punto de interés
 * («Centro Comercial Viva», «Hospital San Rafael»).
 *
 * Por eso esto NO es un analizador de direcciones —ese vive en el backend, con
 * sus sinónimos y sus sufijos—, es solo el portero: decide a quién se le
 * pregunta. Se equivoca hacia el lado seguro: si no está claro que sea
 * nomenclatura, va a Google, que es el que resuelve de todo.
 */
export function pareceNomenclaturaColombiana(texto: string): boolean {
  const t = (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Un nombre de lugar rural nunca es nomenclatura, aunque lleve números
  // («Vereda La Doctora sector 2»).
  if (/\b(vereda|corregimiento|finca|hacienda|km|kilometro|parcelacion|resguardo|centro poblado)\b/.test(t)) {
    return false;
  }

  // Tipo de vía + número, y un separador de cruce con su número detrás. Sin el
  // cruce no hay esquina que buscar, y el motor no aporta nada sobre Google.
  const via = '(calle|cll?|carrera|cra|kra|kr|cr|avenida|av|autopista|ak|ac|diagonal|dg|transversal|tv|tr)';
  return new RegExp(`\\b${via}\\s*\\d+[a-z]?\\s*(#|n[°º]|nro\\.?|no\\.?)\\s*\\d`, 'i').test(t);
}

/** Metros entre dos puntos (Haversine). Para decidir si dos fuentes concuerdan. */
export function metrosEntre(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Cuándo se da por bueno que dos fuentes dicen lo mismo.
 *
 * 150 metros es alrededor de una cuadra y media: dentro de eso, las dos
 * apuntan al mismo sitio y la diferencia es la precisión de cada una, no un
 * desacuerdo. Más lejos, una de las dos está equivocada y no hay forma
 * automática de saber cuál — ahí decide el operador.
 */
export const METROS_ACUERDO = 150;

/** Recuadro del municipio, tal como lo entrega el catálogo. */
export interface Recuadro {
  sur: number;
  norte: number;
  oeste: number;
  este: number;
}

/** Lo que dice Google de su propio resultado, en los términos que importan aquí. */
export interface Candidato {
  lat: number;
  lng: number;
  /** `APPROXIMATE` es un centro de ciudad o de barrio, no un portal. */
  tipoUbicacion?: string;
  /** Google encontró algo parecido, no lo que se pidió. */
  coincidenciaParcial?: boolean;
}

export interface Veredicto {
  /**
   * Hoy siempre es cierto: nada se rechaza. Se conserva porque las dos vías
   * que llaman a esto lo consultan, y porque un veredicto que solo puede
   * decir que sí deja de ser un veredicto el día que haga falta decir que no.
   */
  aceptar: boolean;
  /** Vacío cuando no hay nada que advertir. */
  aviso: string;
}

/**
 * El veredicto sobre un resultado del geocodificador: qué tan de fiar es EL
 * PUNTO.
 *
 * Aquí no se compara contra ningún municipio. Eso existió y se quitó: la
 * búsqueda es libre, igual que en Google Maps, y el municipio del caso se
 * rellena con el que diga la dirección encontrada en vez de ser una condición
 * previa. Advertir «esto no está en Retiro» cada vez que el operador busca una
 * vereda que está en el límite —o que simplemente pertenece al municipio
 * vecino— era ruido sobre una decisión que ya tomó él, y además dependía de
 * que el recuadro del municipio fuera correcto.
 *
 * Lo que sí se sigue diciendo es lo que el operador NO puede ver por sí mismo:
 * que el punto es aproximado, o que el geocodificador resolvió otra cosa
 * parecida a lo que se escribió. Eso no es jurisdicción, es precisión.
 */
export function evaluarCandidato(c: Candidato): Veredicto {
  // Un centro de ciudad o de barrio, no un portal. El punto sirve para
  // orientarse y no para despachar: hay que decirlo.
  if (c.tipoUbicacion === 'APPROXIMATE') {
    return {
      aceptar: true,
      aviso: 'Ubicación aproximada: el mapa no encontró la nomenclatura exacta. Ajuste el punto en el mapa.',
    };
  }

  // Google encontró «algo parecido». Casi siempre significa que ignoró parte
  // de lo escrito —el número de la placa, por ejemplo—.
  if (c.coincidenciaParcial) {
    return {
      aceptar: true,
      aviso: 'El mapa no encontró la dirección exacta y propuso la más parecida. Verifique el punto.',
    };
  }

  return { aceptar: true, aviso: '' };
}

/**
 * Lo mínimo del buscador de Google que aquí se toca. Se declara a mano, en vez
 * de usar el tipo del SDK, para poder probar la decisión sin cargar Google.
 */
export interface BuscadorAcotable {
  locationBias?: unknown;
  locationRestriction?: unknown;
}

/** Centro y extensión de un municipio, como los entrega el catálogo. */
export interface PuntoMunicipio {
  lat: number;
  lng: number;
  recuadro: Recuadro | null;
}

/**
 * Radio del sesgo cuando no se conoce la extensión del municipio. Es grueso a
 * propósito: sin recuadro, lo único que se puede hacer es empujar el orden
 * hacia la zona, no delimitarla.
 */
export const RADIO_SESGO_METROS = 30_000;

/**
 * Acota el buscador al municipio SESGANDO, nunca restringiendo.
 *
 * Esto estuvo al revés y costó caro. Con `locationRestriction` —un límite
 * duro— Google deja de proponer todo lo que cae fuera del rectángulo, y no
 * dice por qué: el operador escribe «Vereda Pantanillo», no baja ninguna
 * sugerencia, y no hay nada en pantalla que explique que la hubo y se
 * descartó. Un desplegable vacío parece un sistema roto.
 *
 * Con `locationBias` las sugerencias del municipio van primero y las de fuera
 * siguen estando. Lo que impide despachar a otra ciudad no es callar la
 * sugerencia, es `evaluarCandidato`: al elegirla se verifica contra el
 * recuadro y, si quedó fuera, NO se mueve el punto y se dice en una frase.
 * Misma precisión, y el operador se entera.
 *
 * El recuadro sigue siendo mejor sesgo que un círculo de radio inventado: es
 * la extensión real del municipio.
 */
export function acotarBuscador(el: BuscadorAcotable, u: PuntoMunicipio | null): void {
  if (!u) return;
  const r = u.recuadro;
  el.locationBias = r
    ? { south: r.sur, north: r.norte, west: r.oeste, east: r.este }
    : { center: { lat: u.lat, lng: u.lng }, radius: RADIO_SESGO_METROS };
  // Explícito, no implícito: deshace cualquier restricción previa y deja
  // escrito que aquí nunca se pone una.
  el.locationRestriction = null;
}
