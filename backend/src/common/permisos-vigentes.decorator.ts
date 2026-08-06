import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';

/**
 * Permisos que el usuario tiene AHORA, resueltos por PermisosGuard contra la
 * base. Se usan en lugar de los del token, que quedaron congelados al iniciar
 * sesión y podrían conceder algo que ya se le quitó al rol.
 */
export const PermisosVigentes = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] => {
    const req = ctx.switchToHttp().getRequest();
    if (Array.isArray(req.permisosVigentes)) return req.permisosVigentes;
    const user = req.user as JwtPayload | undefined;
    // Sin @Permisos() en la ruta el guard no resuelve nada; el superadmin
    // tampoco pasa por ahí porque se le concede todo antes.
    return user?.rol === 'superadmin' ? ['*'] : user?.permisos ?? [];
  },
);
