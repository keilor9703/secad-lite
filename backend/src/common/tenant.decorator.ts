import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inyecta el tenantId resuelto por TenantMiddleware en el handler. */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return req.tenantId ?? 'demo';
  },
);
