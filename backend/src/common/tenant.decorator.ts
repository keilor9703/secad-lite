import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';

/**
 * Tenant sobre el que opera la petición.
 *
 *  - Usuario de un tenant: SIEMPRE el del JWT. El header se ignora, así nadie
 *    puede alcanzar los datos de otra instancia cambiándolo.
 *  - Superadmin: es global y no pertenece a ninguno, así que trabaja sobre el
 *    "tenant en gestión" que elige en la interfaz y viaja en `X-Tenant-Id`. Sin
 *    él la petición se rechaza en vez de caer silenciosamente en uno cualquiera.
 *  - Rutas públicas (login civil): el header resuelto por TenantMiddleware.
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user) return req.tenantId ?? 'demo';

    if (user.rol === 'superadmin') {
      const elegido = (req.header('X-Tenant-Id') ?? '').trim();
      if (!elegido) throw new BadRequestException('Seleccione el tenant en gestión.');
      return elegido;
    }
    const propio = user.tenant?.trim();
    if (!propio) throw new BadRequestException('Su usuario no tiene un tenant asignado.');
    return propio;
  },
);
