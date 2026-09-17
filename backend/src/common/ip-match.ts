import { isIPv4, isIPv6 } from 'net';

/**
 * Allowlist de IP para entidades externas (API entrante).
 *
 * Una API key es un secreto compartido: quien la tiene, puede usarla desde
 * cualquier origen. El allowlist no reemplaza la key — la complementa: aunque
 * la key se filtre o se reparta, solo sirve desde las IPs/rangos que la
 * entidad declaró. Pensado para el caso típico de esta integración (una
 * central de alarmas, un backend municipal) que llama siempre desde la misma
 * IP fija o el mismo rango de su proveedor — no para clientes móviles con IP
 * dinámica, que deben dejar el allowlist vacío.
 *
 * IPv6: solo coincidencia exacta (sin CIDR). El universo de entidades de este
 * sistema llama casi siempre por IPv4; no vale la pena la complejidad (y el
 * riesgo de bugs) de un comparador CIDR de 128 bits para un caso marginal.
 */

/** ¿`ip` está permitida según `reglas`? Sin reglas (null/[]), no hay restricción. */
export function ipPermitida(ip: string | undefined | null, reglas: string[] | null | undefined): boolean {
  if (!reglas || reglas.length === 0) return true;
  if (!ip) return false;
  const candidata = normalizarIp(ip);
  return reglas.some((regla) => coincide(candidata, normalizarIp(regla)));
}

/** ¿`regla` es una IP o un CIDR IPv4 sintácticamente válido? Para validar el alta/edición. */
export function esReglaIpValida(regla: string): boolean {
  const [base, prefijo] = regla.trim().split('/');
  if (prefijo === undefined) return isIPv4(base) || isIPv6(base);
  if (!isIPv4(base)) return false; // CIDR solo se admite en IPv4
  const bits = Number(prefijo);
  return Number.isInteger(bits) && bits >= 0 && bits <= 32;
}

/**
 * IPv4 mapeada en IPv6 (::ffff:a.b.c.d, típica de Node/Express) → su forma
 * IPv4 pura, y a minúsculas — una IPv6 admite hex en mayúsculas o minúsculas
 * y la comparación exacta (sin CIDR) es de texto.
 */
function normalizarIp(ip: string): string {
  const limpio = ip.trim().toLowerCase();
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(limpio);
  return mapeada ? mapeada[1] : limpio;
}

function coincide(ip: string, regla: string): boolean {
  if (!regla) return false;
  const [base, prefijo] = regla.split('/');
  if (prefijo === undefined) return ip === base;
  if (!isIPv4(ip) || !isIPv4(base)) return false;
  const bits = Number(prefijo);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mascara = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (aEntero32(ip) & mascara) === (aEntero32(base) & mascara);
}

function aEntero32(ip: string): number {
  return ip.split('.').reduce((acc, octeto) => (acc << 8) | Number(octeto), 0) >>> 0;
}
