import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS_KEY } from './permisos.decorator';
import { JwtPayload } from './auth.service';

/**
 * Autorización por permisos (RBAC dinámico). Lee los permisos exigidos por
 * @Permisos() y verifica que el usuario los tenga (los permisos viajan en el
 * JWT, resueltos del rol al iniciar sesión). El superadmin pasa siempre.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException('No autenticado.');
    if (user.rol === 'superadmin') return true;

    const tiene = requeridos.every((p) => user.permisos?.includes(p));
    if (tiene) return true;
    throw new ForbiddenException('No tiene permiso para esta acción.');
  }
}
