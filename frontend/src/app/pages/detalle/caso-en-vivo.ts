import { Caso } from '../../core/models';

/**
 * Funde en la ficha abierta un caso que acaba de cambiar en el servidor.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * El 22/10/2026: el ciudadano mandó su ubicación por WhatsApp mientras el
 * operador tenía la ficha delante, y había que recargar la página para verla.
 * En una emergencia nadie recarga. Se queda mirando una ficha sin coordenadas,
 * creyendo que el ciudadano no las mandó, y le pide la dirección a quien
 * acaba de mandar el punto exacto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE CONSERVA, Y POR QUÉ
 *
 * El `estado`. En la bandeja de Despacho el servidor manda el estado del
 * CANAL que se está mirando, no el del caso; el socket, en cambio, emite a
 * todo el municipio y trae el macro-estado. Pisar uno con otro movería la
 * ficha de columna —o la sacaría de la bandeja— sin que nadie hubiera hecho
 * nada.
 *
 * Es una función aparte y no tres líneas dentro de la suscripción porque esto
 * es lo que puede estar mal; conectar un `subscribe` no.
 */
export function fusionarCasoEnVivo(actual: Caso | null, llegado: Caso): Caso {
  if (!actual) return llegado;
  return { ...llegado, estado: actual.estado };
}

/** ¿Este cambio es del caso que el operador tiene abierto? */
export function esDelCasoAbierto(llegado: Caso, abierto: string | null): boolean {
  return !!abierto && llegado.id === abierto;
}
