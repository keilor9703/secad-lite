import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PbxApiKeyGuard, PeticionPbx } from './pbx-api-key.guard';

describe('PbxApiKeyGuard', () => {
  let tenants: { porApiKey: jest.Mock; asegurarVigente: jest.Mock };
  let guard: PbxApiKeyGuard;

  const tenantDemo = { codigo: 'demo', integraciones: ['pbx'] } as any;

  function contexto(headers: Record<string, string | string[]>): { ctx: ExecutionContext; req: PeticionPbx } {
    const req = { headers } as unknown as PeticionPbx;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  }

  beforeEach(() => {
    tenants = {
      porApiKey: jest.fn().mockResolvedValue(tenantDemo),
      asegurarVigente: jest.fn(),
    };
    guard = new PbxApiKeyGuard(tenants as any);
  });

  it('con una API key válida, resuelve el tenant, lo deja en req.pbxTenant y permite pasar', async () => {
    const { ctx, req } = contexto({ 'x-api-key': 'clave-ok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(tenants.porApiKey).toHaveBeenCalledWith('clave-ok');
    expect(req.pbxTenant).toBe(tenantDemo);
  });

  it('sin header x-api-key, lanza UnauthorizedException sin consultar TenantsService', async () => {
    const { ctx } = contexto({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(tenants.porApiKey).not.toHaveBeenCalled();
  });

  it('con una API key que no resuelve a ningún tenant, lanza UnauthorizedException', async () => {
    tenants.porApiKey.mockResolvedValue(null);
    const { ctx, req } = contexto({ 'x-api-key': 'clave-invalida' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(req.pbxTenant).toBeUndefined();
  });

  it('si el header llega repetido (array), usa el primer valor', async () => {
    const { ctx } = contexto({ 'x-api-key': ['clave-ok', 'otra'] });
    await guard.canActivate(ctx);
    expect(tenants.porApiKey).toHaveBeenCalledWith('clave-ok');
  });

  it('si el tenant no tiene la integración pbx vigente, propaga la ForbiddenException de asegurarVigente sin fijar req.pbxTenant', async () => {
    tenants.asegurarVigente.mockImplementation(() => {
      throw new ForbiddenException('El módulo de pbx no está habilitado para esta instancia.');
    });
    const { ctx, req } = contexto({ 'x-api-key': 'clave-ok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(req.pbxTenant).toBeUndefined();
  });
});
