import { createHash, createHmac } from 'node:crypto';

/**
 * Firma de las llamadas SALIENTES a la API de Zadarma.
 *
 * Es la hermana de `zadarma.firma.ts` —que verifica lo que ENTRA por el
 * webhook— y comparte con ella la trampa que cuesta una tarde: el resultado es
 * **base64 del texto hexadecimal** del HMAC, no del digest binario. Sale de
 * que los ejemplos oficiales están en PHP y `hash_hmac` devuelve hex salvo que
 * se le pida lo contrario. Con el binario, la API responde «authentication
 * failed» y el mensaje no se parece en nada a la causa.
 *
 * La cadena que se firma es `método + parámetros + md5(parámetros)`, con los
 * parámetros **ordenados por nombre** y codificados como los codifica PHP.
 * Si el orden no coincide, la firma no cuadra; y como el servidor no dice en
 * qué no cuadra, no hay forma de depurarlo desde fuera. De ahí que esto sea
 * una función pura con sus pruebas, y no tres líneas dentro del cliente HTTP.
 *
 * Verificado contra el SDK de la comunidad (`zadarma` en npm, v1.1.2) y contra
 * el ejemplo en PHP de la documentación.
 */

/** Lo que admite un parámetro de la API: todo viaja como texto. */
export type ParametrosZadarma = Record<string, string | number | undefined | null>;

/**
 * Los parámetros como los arma `http_build_query` de PHP sobre un arreglo
 * ordenado por clave.
 *
 * Se replica la codificación de PHP (`urlencode`, RFC 1738) y no la de
 * `encodeURIComponent`, que deja sin escapar `!'()*~`. Con números de teléfono
 * y extensiones da lo mismo —son dígitos y `+`— pero el día que se firme un
 * parámetro con texto libre (un SMS, un nombre) la diferencia es una firma que
 * no cuadra sin ninguna pista de por qué.
 */
export function cadenaParametros(params: ParametrosZadarma): string {
  const utiles = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const claves = utiles.map(([k]) => k).sort();
  const valor = new Map(utiles.map(([k, v]) => [k, String(v)]));
  return claves.map((k) => `${urlencodePhp(k)}=${urlencodePhp(valor.get(k) ?? '')}`).join('&');
}

/** `urlencode` de PHP: espacio como `+`, y nada más intacto que `-_.`. */
function urlencodePhp(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** `base64( HEX( HMAC-SHA1(metodo + params + md5(params), secreto) ) )`. */
export function firmarPeticion(metodo: string, cadena: string, secreto: string): string {
  const md5 = createHash('md5').update(cadena).digest('hex');
  const hex = createHmac('sha1', secreto).update(metodo + cadena + md5).digest('hex');
  return Buffer.from(hex, 'utf8').toString('base64');
}

/** El encabezado `Authorization` que espera Zadarma: la llave y la firma. */
export function encabezadoAutorizacion(key: string, firma: string): string {
  return `${key}:${firma}`;
}

/**
 * ¿La credencial tiene la forma que espera Zadarma (20 caracteres)?
 *
 * No se usa para rechazar —si mañana cambian el formato, esto no puede dejar
 * la integración muerta— sino para poder DECIRLO cuando la API contesta que la
 * autenticación falló. Una llave pegada con un espacio o cortada a la mitad da
 * exactamente el mismo error que un secreto equivocado, y sin esta pista hay
 * que adivinar cuál de los dos es.
 */
export function pareceCredencialZadarma(valor: string): boolean {
  return /^[A-Za-z0-9]{20}$/.test(valor);
}
