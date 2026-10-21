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

/** Dónde dice el ciudadano que está. */
export interface UbicacionCiudadano {
  lat: number;
  lng: number;
  /** La dirección que WhatsApp resuelve, si la trae. */
  direccion?: string;
}

/**
 * Las coordenadas de un mensaje de ubicación, o `null` si no sirven.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE VALIDA Y NO SE GUARDA LO QUE VENGA
 *
 * Una ubicación de WhatsApp es el dato más valioso que existe para un CAD: el
 * ciudadano la manda con un toque y resuelve la pregunta que más tiempo cuesta
 * por teléfono. Precisamente por eso no puede entrar sin mirar.
 *
 * El caso que importa es el `0, 0`. Un campo ausente o ilegible se convierte
 * en cero sin que nada falle, y `0, 0` es un punto REAL en el golfo de Guinea.
 * Guardarlo mandaría una patrulla al Atlántico y, peor, haría creer al
 * despachador que tiene la ubicación — dejaría de preguntarla.
 *
 * Que no haya coordenadas es recuperable: se pregunta. Una coordenada falsa
 * que parece buena, no.
 */
export function ubicacionDe(m: unknown): UbicacionCiudadano | null {
  // Dos convenciones conviven entre proveedores: unos ponen las coordenadas
  // al nivel del mensaje y otros las anidan en `location`. Se aceptan las
  // dos, porque distinguirlas no aporta nada y equivocarse cuesta la
  // ubicación de una emergencia.
  const raw = m as { location?: unknown } | null;
  const msg = (raw?.location ?? raw) as {
    latitude?: unknown; longitude?: unknown; address?: unknown; name?: unknown;
  } | null;
  const lat = Number(msg?.latitude);
  const lng = Number(msg?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // La isla nula. Ver el comentario de arriba.
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const direccion = [msg?.name, msg?.address]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' · ');

  return direccion ? { lat, lng, direccion } : { lat, lng };
}

/**
 * La FORMA de un mensaje: sus campos, sin su contenido.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * El traductor de Infobip se escribió contra el formato documentado, antes de
 * haber visto una entrega real. El 22/10/2026 una foto y una ubicación reales
 * no se pudieron leer, y averiguar por qué era imposible: el log decía que
 * había fallado, no QUÉ venía dentro.
 *
 * Esto cierra ese agujero sin abrir otro. Devuelve los NOMBRES de los campos
 * y nunca sus valores, así que un mensaje de un ciudadano —su texto, su
 * dirección, sus coordenadas— no acaba escrito en el log de un servidor.
 */
export function formaDe(m: unknown, profundidad = 2): string {
  if (m === null || m === undefined) return 'nada';
  if (Array.isArray(m)) return `[${m.length}]`;
  if (typeof m !== 'object') return typeof m;
  if (profundidad <= 0) return '{…}';

  const campos = Object.entries(m as Record<string, unknown>).map(([k, v]) => {
    if (v && typeof v === 'object') return `${k}${formaDe(v, profundidad - 1)}`;
    return k;
  });
  return `{${campos.join(',')}}`;
}

/**
 * ¿Este número puede tener WhatsApp?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY QUE PREGUNTARLO ANTES DE INTENTARLO
 *
 * El proveedor acepta la petición y responde 200 aunque el número sea un fijo
 * sin WhatsApp: el rechazo llega después, por un informe de entrega que no
 * estamos escuchando. Así que sin esta comprobación, mandarle el enlace a un
 * teléfono fijo salía «enviado por WhatsApp», el ciudadano no recibía nada, y
 * —lo peor— nunca se intentaba el SMS, que sí le habría llegado.
 *
 * En Colombia un móvil son diez dígitos que empiezan por 3; un fijo tiene
 * siete u ocho, o diez empezando por 60. Se mira la cola porque el mismo
 * número llega con indicativo y sin él.
 *
 * Es deliberadamente permisivo: ante la duda devuelve `true` y se intenta.
 * Equivocarse hacia «intentar WhatsApp» cuesta una petición de más; hacia «no
 * intentarlo» cuesta mandar por SMS algo que habría llegado mejor.
 */
export function pareceMovil(telefono: string): boolean {
  const d = (telefono ?? '').replace(/\D/g, '');
  if (d.length < 10) return false;
  return d.slice(-10).startsWith('3');
}
