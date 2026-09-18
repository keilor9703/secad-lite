/**
 * Rangos de IP publicados por Cloudflare (https://www.cloudflare.com/ips/),
 * los únicos desde donde debe llegar tráfico si el dominio está detrás de su
 * proxy (nube naranja). Sirven para UNA sola cosa: decidir si vale la pena
 * confiar en la cabecera `CF-Connecting-IP` (ver `ip-cliente.decorator.ts`) —
 * no son un allowlist de seguridad por sí mismos.
 *
 * Cambian muy rara vez. Si algún día Cloudflare anuncia un rango nuevo y hace
 * falta actualizarlo, esta es la única lista que tocar.
 */
export const RANGOS_CLOUDFLARE_V4: string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/**
 * IPv6 de Cloudflare: no se verifican aquí. El comparador de este proyecto
 * (`ip-match.ts`) solo hace coincidencia exacta en IPv6, sin CIDR — mismo
 * límite ya asumido a propósito para el allowlist de entidades externas.
 * Un cliente que llegue por IPv6 detrás de Cloudflare cae al respaldo
 * (`req.ip`), sin el ajuste de `CF-Connecting-IP`.
 */
