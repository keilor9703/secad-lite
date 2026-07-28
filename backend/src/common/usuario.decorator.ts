import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';

/** Inyecta los claims del usuario autenticado (req.user). */
export const Usuario = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    return ctx.switchToHttp().getRequest().user;
  },
);
