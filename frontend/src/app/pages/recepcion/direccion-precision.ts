/**
 * ¿Se puede confiar en el punto que devolvió el geocodificador?
 *
 * Hasta ahora no se preguntaba: lo que viniera se aplicaba. Buscar
 * «Calle 53 # 52-35» desde Itagüí podía dejar el punto en Barranquilla, cambiar
 * el municipio del caso en silencio, y nadie se enteraba hasta que la patrulla
 * no encontraba la dirección. En un CAD eso no es un resultado malo, es una
 * unidad enviada a otra ciudad.
 *
 * Aquí se decide una sola cosa —aceptar o no, y con qué advertencia— y se
 * decide aparte del formulario para poder probarla entera.
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
  /** Municipio que Google dice que es, si lo dijo. */
  municipioResuelto?: string;
}

export interface Veredicto {
  /** Si es falso, el punto NO se mueve: es preferible no ubicar a ubicar mal. */
  aceptar: boolean;
  /** Vacío cuando no hay nada que advertir. */
  aviso: string;
}

/**
 * Margen sobre el recuadro del municipio, en grados (~1,5 km).
 *
 * El recuadro es un rectángulo sobre una frontera que no lo es, y el
 * geocodificador tiene su propio error. Sin margen, una dirección legítima
 * pegada al límite se rechazaría; con uno muy grande vuelve a colarse el
 * municipio vecino. Kilómetro y medio es el ancho de un barrio.
 */
const MARGEN_GRADOS = 0.0135;

/** ¿El punto cae dentro del municipio, con el margen de cortesía? */
export function dentroDelRecuadro(lat: number, lng: number, r: Recuadro): boolean {
  return lat >= r.sur - MARGEN_GRADOS
      && lat <= r.norte + MARGEN_GRADOS
      && lng >= r.oeste - MARGEN_GRADOS
      && lng <= r.este + MARGEN_GRADOS;
}

/** Compara nombres de municipio sin acentos ni mayúsculas. */
function mismoNombre(a: string, b: string): boolean {
  const n = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return n(a) === n(b);
}

/**
 * El veredicto sobre un resultado del geocodificador.
 *
 * `recuadro` nulo significa que no se conoce la extensión del municipio: ahí no
 * se puede rechazar por ubicación, y lo honesto es aceptar advirtiendo, no
 * inventar un límite.
 */
export function evaluarCandidato(
  c: Candidato,
  municipio: string,
  recuadro: Recuadro | null,
  /**
   * ¿Ese nombre es OTRO municipio del catálogo?
   *
   * Hace falta para no alarmar en lo rural: al buscar «Vereda El Pedregal,
   * Itagüí», Google suele devolver como localidad el nombre del corregimiento o
   * del centro poblado, no el del municipio. Comparando nombres a secas, cada
   * búsqueda rural salía advertida de estar en otro municipio — y una
   * advertencia que aparece siempre deja de leerse.
   *
   * Solo se advierte cuando el nombre es, de verdad, otro municipio.
   */
  esOtroMunicipio: (nombre: string) => boolean = () => true,
): Veredicto {
  // 1. Fuera del municipio: esto no se acepta ni con advertencia. Es el caso
  //    que manda una unidad a otra ciudad.
  if (recuadro && !dentroDelRecuadro(c.lat, c.lng, recuadro)) {
    const donde = c.municipioResuelto ? ` (quedó en ${c.municipioResuelto})` : '';
    return {
      aceptar: false,
      aviso: `Esa dirección no está en ${municipio}${donde}. Revise la dirección, o cambie el municipio del caso si corresponde.`,
    };
  }

  // 2. Dentro, pero Google dice que es otro municipio. Puede ser un corregimiento
  //    o un nombre distinto del mismo sitio: se acepta y se avisa, sin cambiar
  //    el municipio del caso a espaldas del operador.
  if (c.municipioResuelto
      && !mismoNombre(c.municipioResuelto, municipio)
      && esOtroMunicipio(c.municipioResuelto)) {
    return {
      aceptar: true,
      aviso: `El mapa ubicó esta dirección en ${c.municipioResuelto}, no en ${municipio}. Verifique el punto.`,
    };
  }

  // 3. Un centro de ciudad o de barrio, no un portal. El punto sirve para
  //    orientarse y no para despachar: hay que decirlo.
  if (c.tipoUbicacion === 'APPROXIMATE') {
    return {
      aceptar: true,
      aviso: 'Ubicación aproximada: el mapa no encontró la nomenclatura exacta. Ajuste el punto en el mapa.',
    };
  }

  // 4. Google encontró «algo parecido». Casi siempre significa que ignoró parte
  //    de lo escrito —el número de la placa, por ejemplo—.
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
