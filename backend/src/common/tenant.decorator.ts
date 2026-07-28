import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Inyecta el tenant del request. En rutas protegidas proviene del JWT
 * (`req.user.tenant`), que NO se puede falsear; como respaldo (rutas públicas,
 * previo al login) usa el header resuelto por TenantMiddleware.
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.user?.tenant ?? req.tenantId ?? 'demo';
  },
);
