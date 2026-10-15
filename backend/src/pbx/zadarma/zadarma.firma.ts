import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * La firma de los webhooks de Zadarma.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL DETALLE QUE CUESTA UNA TARDE
 *
 * La firma es `base64( HEX( HMAC-SHA1(cadena, secreto) ) )`. No es base64 del
 * digest binario, que es lo que uno escribe por inercia: es base64 **del texto
 * hexadecimal**. Sale de que el ejemplo oficial está en PHP —
 * `base64_encode(hash_hmac('sha1', $cadena, $secreto))`— y `hash_hmac` de PHP
 * devuelve hex salvo que se le pida lo contrario. Con el digest binario la
 * comparación NUNCA coincide, y el síntoma es «Zadarma manda pero FALCON lo
 * rechaza todo», que no se parece en nada a la causa.
 *
 * Cada evento firma una cadena distinta, y tampoco es la concatenación de todo
 * el cuerpo: son tres campos concretos, pegados sin separador, distintos según
 * el evento. Si esa tabla se equivoca para UN evento, ese evento se rechaza y
 * los demás pasan — así que se prueba evento por evento.
 *
 * Verificado contra el SDK de la comunidad (`zadarma` en npm) y contra el
 * ejemplo en PHP de la documentación; falta confirmarlo con tráfico real, que
 * es lo que hará la primera llamada de prueba. Por eso el verificador puede
 * correr en modo *observación* (ver `verificarFirma`).
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Los eventos que Zadarma manda a un webhook de centralita. */
export const EVENTOS_ZADARMA = [
  'NOTIFY_START',
  'NOTIFY_INTERNAL',
  'NOTIFY_ANSWER',
  'NOTIFY_END',
  'NOTIFY_INTERNAL_END',
  'NOTIFY_OUT_START',
  'NOTIFY_OUT_END',
  'NOTIFY_RECORD',
  'NOTIFY_IVR',
  'SMS',
] as const;

export type EventoZadarma = (typeof EVENTOS_ZADARMA)[number];

/** El cuerpo tal como llega: `x-www-form-urlencoded`, todo texto. */
export type CuerpoZadarma = Record<string, string | undefined>;

/**
 * Qué campos firma cada evento, en orden y sin separador.
 *
 * `NOTIFY_INTERNAL_END` no está en la documentación —aparece en el tráfico
 * real y el propio SDK de la comunidad lo llama «evento fantasma»—, así que se
 * trata como su pariente `NOTIFY_INTERNAL`: si algún día firma otra cosa, se
 * rechazará y quedará en el registro, que es mejor que aceptarlo a ciegas.
 */
const CAMPOS_FIRMADOS: Record<EventoZadarma, string[]> = {
  NOTIFY_START: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_INTERNAL: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_INTERNAL_END: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_END: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_IVR: ['caller_id', 'called_did', 'call_start'],
  NOTIFY_ANSWER: ['caller_id', 'destination', 'call_start'],
  NOTIFY_OUT_START: ['internal', 'destination', 'call_start'],
  NOTIFY_OUT_END: ['internal', 'destination', 'call_start'],
  NOTIFY_RECORD: ['pbx_call_id', 'call_id_with_rec'],
  SMS: ['result'],
};

/** La cadena que se firma para un evento, o null si el evento no se conoce. */
export function cadenaFirmada(cuerpo: CuerpoZadarma): string | null {
  const evento = cuerpo.event as EventoZadarma | undefined;
  const campos = evento ? CAMPOS_FIRMADOS[evento] : undefined;
  if (!campos) return null;
  return campos.map((c) => cuerpo[c] ?? '').join('');
}

/** `base64(hex(hmac_sha1(cadena, secreto)))` — ver el comentario de arriba. */
export function firmar(cadena: string, secreto: string): string {
  const hex = createHmac('sha1', secreto).update(cadena, 'utf8').digest('hex');
  return Buffer.from(hex, 'utf8').toString('base64');
}

export type ResultadoFirma =
  | { ok: true }
  | { ok: false; motivo: string; esperada?: string };

/**
 * ¿La firma del encabezado corresponde a este cuerpo?
 *
 * Se compara en tiempo constante. No es paranoia de manual: una comparación
 * normal corta en el primer byte distinto, y eso deja medir cuántos aciertos
 * lleva una firma inventada — con suficientes intentos se construye una
 * válida sin conocer el secreto.
 */
export function verificarFirma(
  cuerpo: CuerpoZadarma, firmaRecibida: string | undefined, secreto: string,
): ResultadoFirma {
  if (!secreto) return { ok: false, motivo: 'No hay secreto de Zadarma configurado para esta instancia.' };
  if (!firmaRecibida) return { ok: false, motivo: 'La petición no trae encabezado Signature.' };

  const cadena = cadenaFirmada(cuerpo);
  if (cadena === null) return { ok: false, motivo: `Evento de Zadarma no reconocido: ${cuerpo.event ?? '(sin event)'}.` };

  const esperada = firmar(cadena, secreto);
  const a = Buffer.from(firmaRecibida, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  // `timingSafeEqual` exige el mismo largo: una firma de otro largo no puede
  // ser válida, y devolverlo así no filtra nada que no se supiera ya.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'La firma no corresponde al cuerpo de la petición.', esperada };
  }
  return { ok: true };
}
