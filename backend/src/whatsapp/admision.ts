/**
 * LA ADMISIÓN: decidir si un mensaje de WhatsApp es una emergencia.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 *
 * **En caso de duda, se abre el caso.**
 *
 * Esto filtra una línea 123. Un falso positivo es un caso de más en la
 * bandeja: molesto, y se cierra en diez segundos. Un falso negativo es una
 * emergencia descartada en silencio. No son comparables, y por eso el filtro
 * NO intenta reconocer emergencias: reconoce **ruido**, que es una lista
 * cerrada y corta de palabras que no pueden significar nada más.
 *
 * Cualquier cosa que no esté en esa lista abre caso. «fuego» tiene cinco
 * letras y es una emergencia, así que tampoco hay regla de longitud mínima.
 *
 * Añadir una palabra a la lista de ruido es añadir una forma de perder una
 * emergencia. Cada una tiene que poder defenderse sola.
 */

/**
 * Palabras que por sí solas no piden nada.
 *
 * Deliberadamente corta. Están los saludos, las cortesías y las pruebas, que
 * es lo que de verdad llega a una línea publicada. NO están —y no deben
 * estar— «ayuda», «auxilio», «socorro», «rápido», «urgente» ni nada que
 * pueda ser una petición.
 */
const RUIDO = new Set([
  'hola', 'ola', 'alo', 'hey', 'hi', 'hello', 'saludos', 'buenas', 'buen',
  'buenos', 'dia', 'dias', 'tarde', 'tardes', 'noche', 'noches',
  'que', 'mas', 'tal', 'como', 'estan', 'esta',
  'gracias', 'ok', 'oka', 'okay', 'listo', 'vale', 'bueno', 'si', 'no',
  // Cuantificadores de cortesía: solo pueden hacer daño si TODO el resto
  // del mensaje también es ruido («muchas gracias», «mucho gusto»). En
  // «muchos heridos» la palabra «heridos» abre el caso igual.
  'muchas', 'muchos', 'mucha', 'mucho', 'gusto',
  'prueba', 'pruebas', 'test', 'testing',
  'señores', 'senores', 'cordial', 'cordialmente', 'atentamente',
]);

/** Acentos fuera y minúsculas, para comparar sin sorpresas. */
function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Las palabras de un texto, normalizadas.
 *
 * Las letras repetidas se colapsan —«holaaaa» es «hola», «siii» es «si»—
 * porque es como escribe la gente y no queremos que un alargamiento convierta
 * un saludo en una emergencia. Se colapsan solo las rachas de TRES o más: en
 * español hay palabras con letra doble («arroz», «carro») y aplastarlas
 * cambiaría el texto de verdad.
 */
export function palabras(texto: string): string[] {
  return sinAcentos(texto ?? '')
    .replace(/(.)\1{2,}/g, '$1')
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

/**
 * ¿Este texto es solo ruido?
 *
 * Verdadero únicamente si TODAS sus palabras están en la lista cerrada. Una
 * sola palabra desconocida basta para que abra caso: «buenas noches
 * porfavor» no es un saludo, es alguien pidiendo algo con educación.
 *
 * Un texto sin ninguna letra ni número —solo emoji o puntuación— también es
 * ruido: un sticker no es un reporte. Pero ojo, eso vale para el TEXTO; un
 * audio o una ubicación nunca pasan por aquí, porque quien se esconde de un
 * agresor manda una nota de voz y no va a contestar un menú.
 */
export function esRuido(texto: string): boolean {
  const ps = palabras(texto);
  if (!ps.length) return true;
  return ps.every((p) => RUIDO.has(p));
}

/** Una opción de tipificación, tal como se le ofrece al ciudadano. */
export interface OpcionTipo {
  /** El número que teclea el ciudadano, empezando en 1. */
  numero: number;
  /** El código del catálogo del municipio. Nulo en la opción «otra». */
  codigo: string | null;
  descripcion: string;
}

/** Cuántas opciones caben sin que el mensaje se vuelva ilegible en un móvil. */
export const MAX_OPCIONES = 9;

/**
 * Arma el menú de tipificación con el catálogo del municipio.
 *
 * Sale del catálogo real —con su prioridad y su agencia sugerida— y no de una
 * lista fija, porque la tipificación de un municipio es suya: es lo que
 * después alimenta sus reportes y sus indicadores.
 *
 * La última opción siempre es «otra», y existe para que el menú no sea una
 * jaula: un catálogo nunca cubre todo lo que pasa en la calle.
 */
export function menuDeTipos(
  codigos: { codigo: string; descripcion: string }[],
): OpcionTipo[] {
  const ops: OpcionTipo[] = codigos
    .slice(0, MAX_OPCIONES)
    .map((c, i) => ({ numero: i + 1, codigo: c.codigo, descripcion: c.descripcion }));
  return [...ops, { numero: ops.length + 1, codigo: null, descripcion: 'Otra cosa' }];
}

/** El texto del menú, numerado. */
export function textoDelMenu(ops: OpcionTipo[]): string {
  const lineas = ops.map((o) => `${o.numero}. ${o.descripcion}`).join('\n');
  return `Para atenderlo mejor, responda con el número:\n${lineas}`;
}

/**
 * Qué opción eligió el ciudadano, o `null` si no eligió ninguna.
 *
 * Se busca un número suelto al principio del mensaje, no en cualquier parte:
 * «2» es elegir la opción 2, pero «hay 2 heridos en la calle 50» NO lo es, y
 * confundirlos tipificaría mal un caso con heridos. Por eso el número tiene
 * que ir solo o abrir el mensaje seguido de un separador.
 */
export function opcionElegida(texto: string, ops: OpcionTipo[]): OpcionTipo | null {
  const m = /^\s*(\d{1,2})\s*[.)-]?\s*$/.exec(texto ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  return ops.find((o) => o.numero === n) ?? null;
}
