import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { JwtPayload } from './auth.service';

/**
 * Guard global: exige un JWT válido salvo en handlers marcados con @Public().
 * Verificado el token, adjunta los claims a `req.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.header('Authorization') ?? '';
    const [scheme, token] = auth.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de autenticación.');
    }
    try {
      (req as any).user = this.jwt.verify<JwtPayload>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado.');
    }
  }
}
