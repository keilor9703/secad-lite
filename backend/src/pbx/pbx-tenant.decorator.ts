import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TenantEntity } from '../tenants/tenant.entity';
import { PeticionPbx } from './pbx-api-key.guard';

/**
 * El tenant que `PbxApiKeyGuard` ya resolvió y dejó en `req.pbxTenant`. Si
 * llega a faltar (no debería: el guard corre siempre antes) se rechaza en
 * vez de seguir con un tenant vacío — mismo criterio defensivo que `@Tenant()`
 * para las rutas autenticadas.
 */
export const PbxTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantEntity => {
    const req = ctx.switchToHttp().getRequest<PeticionPbx>();
    if (!req.pbxTenant) throw new UnauthorizedException('API key inválida.');
    return req.pbxTenant;
  },
);
