/**
 * POR DÓNDE SALE EL ENLACE DE LA VIDEOLLAMADA, Y EN QUÉ ORDEN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES CONFIGURABLE
 *
 * Los tres caminos no son equivalentes y lo que conviene depende del
 * municipio, no del código:
 *
 *  - `whatsapp` (texto libre) no cuesta, pero solo se puede dentro de las 24
 *    horas siguientes al último mensaje DEL CIUDADANO. Un caso que nació de
 *    una llamada no tiene esa ventana abierta.
 *  - `plantilla` es la única forma de escribirle PRIMERO a alguien por
 *    WhatsApp. Llega como un botón, no como un enlace suelto, así que el
 *    operador tiene que explicárselo. Solo sirve con móviles.
 *  - `sms` llega a cualquier teléfono, no necesita datos ni WhatsApp, y se
 *    paga siempre. En muchos teléfonos el enlace no se vuelve pulsable y el
 *    ciudadano tiene que teclear una URL en plena emergencia.
 *
 * Un municipio con plan de SMS incluido puede preferirlo primero por
 * fiabilidad; otro que paga cada mensaje lo querrá al final. No hay una
 * respuesta correcta, y por eso se elige en Administración.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA GARANTÍA QUE NO SE NEGOCIA
 *
 * Una configuración vacía, mal escrita o traída de una versión anterior NO
 * puede dejar al ciudadano sin enlace por ningún camino. Siempre que no se
 * entienda lo guardado, se vuelve al orden automático. Es la diferencia entre
 * un ajuste y una avería silenciosa.
 */

/** Los tres caminos, con el nombre con el que se guardan. */
export type CanalEnlace = 'whatsapp' | 'plantilla' | 'sms';

export const CANALES_ENLACE: readonly CanalEnlace[] = ['whatsapp', 'plantilla', 'sms'];

/**
 * El orden que decide el sistema cuando nadie ha elegido.
 *
 * Primero lo gratis y pulsable, después lo que permite escribir primero, y el
 * SMS al final porque se paga y llega peor — pero llega a todos, y por eso es
 * el último y no se quita.
 */
export const ORDEN_AUTOMATICO: readonly CanalEnlace[] = ['whatsapp', 'plantilla', 'sms'];

/** Por dónde salió, tal como se le cuenta al despachador. */
export type PorDondeSalio = 'whatsapp' | 'whatsapp-plantilla' | 'sms' | null;

function esCanal(x: string): x is CanalEnlace {
  return (CANALES_ENLACE as readonly string[]).includes(x);
}

/**
 * Lee lo guardado en la instancia y devuelve el orden a usar.
 *
 * Tolerante a propósito: separa por comas o espacios, ignora mayúsculas, se
 * salta lo que no reconoce y colapsa repetidos conservando la primera
 * aparición. Si de todo eso no queda ningún canal, devuelve el automático
 * —nunca una lista vacía, que sería un ciudadano sin enlace.
 */
export function parsearOrden(guardado?: string | null): CanalEnlace[] {
  const partes = (guardado ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const orden: CanalEnlace[] = [];
  for (const p of partes) {
    if (esCanal(p) && !orden.includes(p)) orden.push(p);
  }
  return orden.length ? orden : [...ORDEN_AUTOMATICO];
}

/**
 * Cómo se guarda un orden elegido a mano. `null` significa «que decida el
 * sistema», y es lo que se guarda también cuando el orden elegido coincide
 * con el automático: así, si mañana cambia la lógica por defecto, el cambio
 * alcanza a quien nunca eligió nada.
 */
/**
 * De una lista cualquiera, los canales que FALCON reconoce, en el mismo orden
 * y sin repetidos.
 *
 * Existe aparte de `textoDeOrden` porque hay que poder distinguir dos cosas
 * que allí se ven iguales: una lista con cero canales válidos —que es un
 * error del que avisar— y una lista que coincide con el orden automático
 * —que es perfectamente legítima y se guarda como nulo—. Confundirlas
 * rechazaba con un 400 al administrador que eligiera a mano, y en ese orden,
 * los tres caminos de siempre.
 */
export function canalesValidos(orden: readonly string[]): CanalEnlace[] {
  const limpio: CanalEnlace[] = [];
  for (const x of orden) {
    const p = String(x ?? '').trim().toLowerCase();
    if (esCanal(p) && !limpio.includes(p)) limpio.push(p);
  }
  return limpio;
}

export function textoDeOrden(orden: readonly string[] | null | undefined): string | null {
  if (!orden) return null;
  const limpio = canalesValidos(orden);
  if (!limpio.length) return null;
  if (limpio.length === ORDEN_AUTOMATICO.length
      && limpio.every((c, i) => c === ORDEN_AUTOMATICO[i])) return null;
  return limpio.join(',');
}

/**
 * Intenta los caminos en el orden dado y se queda con el PRIMERO que funcione.
 *
 * Que un camino reviente no puede impedir que se pruebe el siguiente: el SMS
 * existe justamente para cuando WhatsApp falla, y una excepción no atrapada
 * aquí dejaba al ciudadano sin enlace teniendo el camino alterno disponible.
 */
export async function enviarPorElPrimeroQuePueda(
  orden: readonly CanalEnlace[],
  intentos: {
    whatsapp: () => Promise<boolean>;
    plantilla: () => Promise<boolean>;
    sms: () => Promise<boolean>;
  },
  /** Para dejar anotado el camino que falló sin tumbar el envío. */
  anotarFallo?: (canal: CanalEnlace, error: Error) => void,
): Promise<PorDondeSalio> {
  for (const canal of orden) {
    try {
      if (await intentos[canal]()) {
        return canal === 'plantilla' ? 'whatsapp-plantilla' : canal;
      }
    } catch (e) {
      anotarFallo?.(canal, e as Error);
    }
  }
  return null;
}
