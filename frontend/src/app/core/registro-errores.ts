/**
 * Los últimos errores que vio ESTE navegador, para adjuntarlos a un reporte de
 * soporte.
 *
 * El 80 % de los reportes de un CAD llegan como "no me funciona". Sin esto, la
 * mesa de ayuda gasta la primera media hora averiguando qué pasó, y lo que
 * pasó ya se lo llevó el recargado de la página: la consola del navegador la
 * ve el operador, no quien atiende el caso de soporte. Aquí queda un rastro
 * corto y acotado que viaja con el reporte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ NO ENTRA, Y POR QUÉ. Esto se va a adjuntar a un correo o a un ticket,
 * es decir, va a salir del sistema:
 *
 *  - El token de la sesión: es una credencial viva. Nunca.
 *  - Los cuerpos de las peticiones y las respuestas: ahí viajan el relato de
 *    la emergencia, el teléfono y la dirección del ciudadano. Un ticket de
 *    soporte no es lugar para datos de una víctima (Ley 1581 de 2012).
 *  - La cadena de consulta de la URL: una búsqueda por teléfono deja el
 *    teléfono ahí. Se guarda solo la ruta.
 *
 * Lo que sí entra: el método, la ruta, el código de estado y el mensaje que el
 * backend puso en `message` — que es texto nuestro, escrito para que lo lea
 * una persona, no dato del ciudadano.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Cuántos se conservan. Los más viejos se van cayendo. */
export const MAXIMO = 25;

/** Tope de caracteres por mensaje: un stack entero no cabe en un ticket. */
const LARGO_MAXIMO_MENSAJE = 300;

export interface ErrorRegistrado {
  /** ISO 8601, en UTC — la hora local del puesto se deduce con la zona del informe. */
  en: string;
  tipo: 'http' | 'js';
  /** `GET /api/casos` para HTTP; el nombre del error para JS. */
  que: string;
  /** Código de estado HTTP, cuando aplica. */
  estado?: number;
  /** Mensaje, recortado. */
  detalle: string;
  /** Cuántas veces seguidas se repitió el mismo error. Ausente = una sola. */
  veces?: number;
}

let registro: ErrorRegistrado[] = [];

/** Los errores recientes, del más viejo al más nuevo. Copia: nadie los muta por fuera. */
export function erroresRecientes(): ErrorRegistrado[] {
  return registro.map((e) => ({ ...e }));
}

/** Para las pruebas y para el cierre de sesión: nada de un usuario pasa al siguiente. */
export function olvidarErrores(): void {
  registro = [];
}

/**
 * Deja la ruta de una URL y descarta todo lo demás. Acepta tanto una URL
 * absoluta como una relativa (que es como las arma el frontend).
 */
export function soloRuta(url: string): string {
  const crudo = String(url ?? '');
  try {
    // La base solo sirve para poder analizar una ruta relativa; no se publica.
    return new URL(crudo, 'http://local').pathname;
  } catch {
    // URL ilegible: se corta a mano en el primer separador de consulta.
    return crudo.split('?')[0].split('#')[0];
  }
}

/** Registra el rechazo de una petición HTTP. */
export function registrarErrorHttp(
  metodo: string,
  url: string,
  estado: number,
  mensaje?: unknown,
): void {
  // Estado 0 es "la petición no llegó a ninguna parte": red caída, servidor
  // apagado, CORS. Es el diagnóstico más frecuente y el que más confunde,
  // porque el backend no puso ningún mensaje y el renglón quedaría mudo.
  const detalle = recortar(textoDe(mensaje)) || (estado === 0 ? 'sin respuesta del servidor' : '');
  agregar({
    en: new Date().toISOString(),
    tipo: 'http',
    que: `${String(metodo ?? '').toUpperCase()} ${soloRuta(url)}`.trim(),
    estado,
    detalle,
  });
}

/** Registra una excepción de JavaScript que llegó al manejador global. */
export function registrarErrorJs(error: unknown): void {
  const e = error as { name?: string; message?: string } | null;
  agregar({
    en: new Date().toISOString(),
    tipo: 'js',
    que: e?.name?.trim() || 'Error',
    detalle: recortar(textoDe(e?.message ?? error)),
  });
}

function agregar(e: ErrorRegistrado): void {
  // Un mismo fallo que se repite se cuenta, no se apila.
  //
  // Los trozos de la grabación de una videollamada se envían cada pocos
  // segundos: con el backend rechazándolos, veinticinco renglones idénticos
  // barrerían del registro justamente los errores que explican el problema —y
  // el reporte llegaría a la mesa sin la pista que lo resolvía.

  const ultimo = registro[registro.length - 1];
  if (ultimo && ultimo.que === e.que && ultimo.estado === e.estado && ultimo.detalle === e.detalle) {
    ultimo.veces = (ultimo.veces ?? 1) + 1;
    ultimo.en = e.en; // la hora que importa es la de la última vez
    return;
  }

  registro.push(e);
  // Acotado por arriba: esto corre durante turnos de doce horas sin recargar la
  // página. Sin el tope, un backend caído que rechaza cada sondeo llena la
  // memoria del puesto de despacho.
  if (registro.length > MAXIMO) registro = registro.slice(registro.length - MAXIMO);
}

function textoDe(valor: unknown): string {
  if (valor == null) return '';
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) return valor.map((v) => textoDe(v)).filter(Boolean).join(' · ');
  // Un objeto (p. ej. el cuerpo de error de Nest) NO se serializa entero: solo
  // su `message`, que es el texto que escribimos nosotros. Serializarlo
  // completo es por donde se escaparían los datos del caso.
  const msg = (valor as { message?: unknown }).message;
  if (msg != null) return textoDe(msg);
  return '';
}

function recortar(texto: string): string {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > LARGO_MAXIMO_MENSAJE
    ? `${limpio.slice(0, LARGO_MAXIMO_MENSAJE)}…`
    : limpio;
}
