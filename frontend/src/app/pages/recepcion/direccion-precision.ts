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
  if (c.municipioResuelto && !mismoNombre(c.municipioResuelto, municipio)) {
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
