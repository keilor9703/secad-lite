import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { JwtPayload } from './auth.service';

/**
 * Verifica que el usuario autenticado tenga uno de los roles exigidos por
 * @Roles(). Se ejecuta después del JwtAuthGuard (que ya puso req.user).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (user && requeridos.includes(user.rol)) return true;
    throw new ForbiddenException('No tiene permisos para esta acción.');
  }
}
