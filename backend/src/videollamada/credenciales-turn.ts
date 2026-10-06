import { createHmac } from 'crypto';

/**
 * Credenciales de vida corta para el TURN (coturn con `use-auth-secret`).
 *
 * El problema que resuelve: hasta ahora la credencial del TURN era estática y
 * viajaba en `/config/runtime.json`, que es un archivo PÚBLICO —lo descarga el
 * navegador de cada ciudadano antes de la videollamada—. Es decir, usuario y
 * clave del servidor de relevo estaban publicados en internet, y quien los
 * tomara podía usar el servidor como relevo propio indefinidamente.
 *
 * Con este mecanismo el servidor y el backend comparten un secreto que NUNCA
 * sale del servidor. Lo que llega al navegador es una credencial derivada que
 * caduca en minutos. Si se filtra, se filtra algo que ya venció.
 *
 * El esquema es el de coturn (el mismo de la «TURN REST API»):
 *
 *     username   = <vencimiento unix>:<etiqueta>
 *     credential = base64( HMAC-SHA1( secreto, username ) )
 *
 * coturn recalcula ese HMAC con su `static-auth-secret` y compara; si coincide
 * y el vencimiento no pasó, autoriza. No hay nada que registrar ni revocar.
 */
export interface CredencialTurn {
  /** `<vencimiento unix>:<etiqueta>` — lo que coturn vuelve a firmar. */
  username: string;
  /** El HMAC en base64. */
  credential: string;
  /** Marca unix (segundos) en que coturn deja de aceptarla. */
  venceEn: number;
}

/** Ni tan corta que caduque a mitad de llamada, ni tan larga que no sirva de nada. */
export const SEGUNDOS_POR_DEFECTO = 2 * 60 * 60;

/** Techo duro: una credencial de más de un día no es «de vida corta». */
export const SEGUNDOS_MAXIMOS = 24 * 60 * 60;

/** Piso: por debajo de esto, una llamada normal se quedaría sin relevo. */
export const SEGUNDOS_MINIMOS = 60;

/**
 * La etiqueta identifica QUIÉN pidió la credencial y queda en los logs de
 * coturn. No es un secreto ni autentica nada: coturn solo valida el HMAC.
 * Se limpia porque los dos puntos separan los campos del username y un valor
 * con `:` partiría el formato.
 */
function limpiarEtiqueta(valor: string | undefined | null): string {
  const limpio = (valor ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return limpio || 'falcon';
}

/**
 * Acota la vigencia pedida a un rango razonable. Un valor inválido —texto,
 * negativo, NaN— cae al valor por defecto en vez de producir una credencial
 * ya vencida o eterna.
 */
export function segundosEfectivos(pedido?: number): number {
  if (!Number.isFinite(pedido as number)) return SEGUNDOS_POR_DEFECTO;
  const n = Math.floor(pedido as number);
  if (n < SEGUNDOS_MINIMOS) return SEGUNDOS_MINIMOS;
  if (n > SEGUNDOS_MAXIMOS) return SEGUNDOS_MAXIMOS;
  return n;
}

/**
 * Firma una credencial. `ahoraMs` se inyecta para poder probar el vencimiento
 * sin depender del reloj.
 */
export function firmarCredencial(
  secreto: string,
  etiqueta?: string,
  segundos?: number,
  ahoraMs: number = Date.now(),
): CredencialTurn {
  if (!secreto) throw new Error('Falta el secreto compartido con coturn.');

  const venceEn = Math.floor(ahoraMs / 1000) + segundosEfectivos(segundos);
  const username = `${venceEn}:${limpiarEtiqueta(etiqueta)}`;

  return {
    username,
    credential: createHmac('sha1', secreto).update(username).digest('base64'),
    venceEn,
  };
}
