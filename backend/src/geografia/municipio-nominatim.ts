/**
 * Elegir, de lo que responde Nominatim, el MUNICIPIO — y no cualquier cosa que
 * se llame igual.
 *
 * Esto nació de un fallo real y caro. Se consultaba «Retiro, Antioquia,
 * Colombia» con `limit=1` y se guardaba lo primero que llegara. Nominatim
 * devolvió un lugar llamado Retiro en la zona de Urrao —suroeste de Antioquia,
 * a unos 130 km de El Retiro— y ese recuadro quedó cacheado como si fuera el
 * del municipio. Consecuencias, todas silenciosas:
 *
 *  - El mapa de Recepción se abría en Urrao al elegir Retiro.
 *  - El buscador sesgaba las sugerencias hacia Urrao, así que «Vereda El
 *    Pantanillo» no salía por ningún lado.
 *  - Y la verificación rechazaba TODA dirección real de El Retiro con
 *    «esa dirección no está en Retiro», porque el rectángulo era de otra parte.
 *
 * Un recuadro equivocado es peor que ninguno: sin recuadro solo se pierde
 * precisión, con uno malo se rechaza lo correcto. Por eso aquí se prefiere
 * siempre devolver nada antes que algo dudoso.
 *
 * Se separa del servicio para poder probarlo con respuestas grabadas, sin red.
 */

/** Lo que devuelve Nominatim, en los campos que aquí se miran. */
export interface HitNominatim {
  lat?: string;
  lon?: string;
  /** `boundary` para un límite administrativo; `place` para un caserío o vereda. */
  class?: string;
  /** `administrative` dentro de `boundary`. */
  type?: string;
  display_name?: string;
  /** `[sur, norte, oeste, este]`, como cadenas. */
  boundingbox?: string[];
  address?: { state?: string; country_code?: string };
}

export interface UbicacionElegida {
  lat: number;
  lng: number;
  recuadro: { sur: number; norte: number; oeste: number; este: number } | null;
}

/**
 * Sin acentos, sin mayúsculas, sin puntuación y sin espacios de más.
 *
 * La `ñ` también se reduce a `n` —la descomposición NFD la parte en `n` más
 * tilde, y la tilde cae con el resto—. No es un descuido: se aplica igual a
 * los dos lados de la comparación, así que «El Peñol» del catálogo y «El
 * Penol» de una fuente que perdió el acento siguen siendo el mismo municipio.
 */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El DANE escribe «Retiro», «Carmen de Viboral», «Peñol»; OSM escribe «El
 * Retiro», «El Carmen de Viboral», «El Peñol». Comparar sin el artículo evita
 * descartar el municipio correcto por una palabra que ninguna de las dos
 * fuentes considera parte del nombre.
 */
function sinArticulo(t: string): string {
  return t.replace(/^(el|la|los|las) /, '');
}

function mismoNombre(a: string, b: string): boolean {
  const na = normalizar(a);
  const nb = normalizar(b);
  return na === nb || sinArticulo(na) === sinArticulo(nb);
}

/**
 * Tamaños admisibles para el recuadro de un municipio colombiano, en grados.
 *
 * El piso descarta un caserío o una finca que se hubiera colado como límite
 * administrativo: el municipio más pequeño del país (Sabaneta, 15 km²) mide
 * unos 0,04°. El techo descarta haber enganchado un DEPARTAMENTO entero, que
 * es el otro error posible y dejaría el recuadro inútilmente ancho.
 */
export const LADO_MINIMO_GRADOS = 0.02;
export const LADO_MAXIMO_GRADOS = 3;

function recuadroDe(hit: HitNominatim): UbicacionElegida['recuadro'] {
  const bb = hit.boundingbox?.map(Number);
  if (!bb || bb.length !== 4 || !bb.every(Number.isFinite)) return null;
  const [sur, norte, oeste, este] = bb;
  if (norte <= sur || este <= oeste) return null;
  const alto = norte - sur;
  const ancho = este - oeste;
  if (alto < LADO_MINIMO_GRADOS || ancho < LADO_MINIMO_GRADOS) return null;
  if (alto > LADO_MAXIMO_GRADOS || ancho > LADO_MAXIMO_GRADOS) return null;
  return { sur, norte, oeste, este };
}

/**
 * El municipio entre los resultados, o `null` si ninguno lo es.
 *
 * Se exige que sea un límite administrativo (un municipio lo es; una vereda,
 * una finca o una calle no), que esté en el departamento correcto y que se
 * llame como el municipio. Lo que no pase los tres filtros no se usa, aunque
 * Nominatim lo haya puesto de primero.
 */
export function elegirMunicipio(
  hits: HitNominatim[] | null | undefined,
  nombre: string,
  departamento: string,
): UbicacionElegida | null {
  for (const h of hits ?? []) {
    if (h.class !== 'boundary' || h.type !== 'administrative') continue;
    const cc = h.address?.country_code;
    if (cc && normalizar(cc) !== 'co') continue;
    const estado = h.address?.state;
    if (departamento && estado && !mismoNombre(estado, departamento)) continue;
    const propio = (h.display_name ?? '').split(',')[0] ?? '';
    if (!mismoNombre(propio, nombre)) continue;
    const lat = Number(h.lat);
    const lng = Number(h.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    return { lat, lng, recuadro: recuadroDe(h) };
  }
  return null;
}

/**
 * Las consultas a probar, en orden. La primera es la del catálogo tal cual; la
 * segunda añade el artículo que el DANE omite y OSM sí usa.
 */
export function consultasPara(nombre: string, departamento: string): string[] {
  const base = `${nombre}, ${departamento}, Colombia`;
  const n = normalizar(nombre);
  if (/^(el|la|los|las) /.test(n)) return [base];
  return [base, `El ${nombre}, ${departamento}, Colombia`];
}
