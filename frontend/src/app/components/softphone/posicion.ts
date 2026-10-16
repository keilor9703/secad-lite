/** Dónde está la barra del teléfono, en píxeles desde la esquina superior izquierda. */
export interface Posicion {
  x: number;
  y: number;
}

/** Lo que mide la ventana y lo que mide la barra, para que no se salga. */
export interface Medidas {
  ventanaAncho: number;
  ventanaAlto: number;
  barraAncho: number;
  barraAlto: number;
}

/** Margen mínimo con el borde: pegada al filo no se puede agarrar. */
const MARGEN = 12;

/**
 * El alto de la barra superior de FALCON. La posición por defecto queda justo
 * debajo, no encima: tapar la navegación sería cambiar un estorbo por otro.
 */
const BAJO_LA_CABECERA = 78;

/**
 * DÓNDE ARRANCA LA BARRA, Y HASTA DÓNDE SE PUEDE LLEVAR
 *
 * Aparte del componente a propósito: son reglas con aritmética —que se salga
 * por el borde, que una ventana más pequeña la deje fuera de la pantalla, que
 * una posición guardada de otro monitor sea imposible— y probarlas montando
 * un componente y simulando arrastres cuesta diez veces más que probarlas
 * aquí.
 */

/**
 * Arriba a la derecha, bajo la cabecera.
 *
 * Es el sitio que pidió la operación y tiene su razón: en Recepción la cola
 * va a la izquierda, el formulario al centro y el mapa abajo a la derecha, así
 * que la esquina superior derecha es la única que no tapa nada de lo que se
 * mira mientras se habla. Y es donde ya está el contador de llamadas en
 * espera de la cabecera, que es a donde va el ojo cuando entra una.
 */
export function posicionPorDefecto(m: Medidas): Posicion {
  return acotar({ x: m.ventanaAncho - m.barraAncho - MARGEN, y: BAJO_LA_CABECERA }, m);
}

/**
 * Mete la posición dentro de la ventana.
 *
 * Hace falta en tres momentos distintos y por eso es una sola función: al
 * arrastrar, al cambiar el tamaño de la ventana, y al leer una posición
 * guardada —que puede venir de un monitor más grande, o de antes de que la
 * barra se desplegara y creciera de ancho—.
 */
export function acotar(p: Posicion, m: Medidas): Posicion {
  const maxX = Math.max(MARGEN, m.ventanaAncho - m.barraAncho - MARGEN);
  const maxY = Math.max(MARGEN, m.ventanaAlto - m.barraAlto - MARGEN);
  return {
    x: Math.min(Math.max(p.x, MARGEN), maxX),
    y: Math.min(Math.max(p.y, MARGEN), maxY),
  };
}

const LLAVE = 'falconcad_softphone_pos';

/**
 * La posición que dejó el operador, si la hay y si todavía cabe.
 *
 * Se guarda en el puesto de trabajo y no en el usuario: quien atiende desde
 * dos puestos con pantallas distintas no quiere la misma esquina en los dos,
 * y moverla es un gesto del sitio, no de la persona.
 */
export function posicionGuardada(): Posicion | null {
  try {
    const crudo = localStorage.getItem(LLAVE);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<Posicion>;
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: p.x, y: p.y };
  } catch {
    // Sin almacenamiento (ventana privada, permisos) la barra sigue sirviendo.
    return null;
  }
}

export function guardarPosicion(p: Posicion): void {
  try { localStorage.setItem(LLAVE, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}
