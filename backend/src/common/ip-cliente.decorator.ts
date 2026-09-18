import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { ipPermitida } from './ip-match';
import { RANGOS_CLOUDFLARE_V4 } from './cloudflare-ranges';

/** Lo único que hace falta de la petición — así la lógica se prueba sin un ExecutionContext de Nest. */
export interface PeticionConIp {
  socket?: { remoteAddress?: string | null };
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

/**
 * IP real del visitante, detrás de Cloudflare cuando corresponde.
 *
 * `@Ip()` de Nest (y `req.ip`) resuelven la cadena `X-Forwarded-For` según
 * `trust proxy` (ver main.ts). Eso alcanza cuando hay UN solo proxy delante,
 * pero con un dominio publicado a través de Cloudflare el borde de Cloudflare
 * es en sí mismo ese "un salto" — así que `req.ip` termina siendo la IP del
 * borde de Cloudflare, no la del visitante. Los rangos 108.162.0.0/18,
 * 104.16.0.0/13, 172.64.0.0/13 (entre otros) son justamente Cloudflare.
 *
 * Cloudflare sí manda la IP original en `CF-Connecting-IP` — pero esa
 * cabecera la puede inventar cualquiera que le hable DIRECTO al backend
 * (saltándose Cloudflare), así que solo se confía en ella cuando la conexión
 * de verdad vino de un borde de Cloudflare (`req.socket.remoteAddress` dentro
 * de sus rangos publicados). Sin eso, un atacante podría declararse desde
 * cualquier IP y colarse en el allowlist de una entidad externa con solo
 * agregar una cabecera.
 *
 * Sin Cloudflare por delante (dev local, u otro despliegue), la cabecera no
 * llega o la IP directa no coincide con sus rangos, y se cae a `req.ip` de
 * siempre.
 */
export function resolverIpCliente(req: PeticionConIp): string | undefined {
  const directa = req.socket?.remoteAddress ?? undefined;
  if (directa && ipPermitida(directa, RANGOS_CLOUDFLARE_V4)) {
    const cf = req.headers['cf-connecting-ip'];
    const cfIp = (Array.isArray(cf) ? cf[0] : cf)?.trim();
    if (cfIp) return cfIp;
  }
  return req.ip;
}

export const IpCliente = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => resolverIpCliente(ctx.switchToHttp().getRequest<Request>()),
);
