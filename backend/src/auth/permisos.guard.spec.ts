import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PermisosGuard } from './permisos.guard';
import { Reflector } from '@nestjs/core';
import { RolesService } from '../roles/roles.service';
import { UsuariosService } from '../usuarios/usuarios.service';

describe('PermisosGuard', () => {
  let guard: PermisosGuard;
  let reflector: Reflector;

  const makeCtx = (payload: object) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: payload }) }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PermisosGuard,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn() } },
        {
          provide: UsuariosService,
          useValue: {
            buscarPorUsernameYTenant: jest.fn().mockResolvedValue({
              username: 'op1', rol: 'operador', tenant: 'demo', activo: true,
            }),
          },
        },
        {
          provide: RolesService,
          useValue: { permisosDe: jest.fn().mockResolvedValue(['casos.ver', 'casos.crear']) },
        },
      ],
    }).compile();

    guard = module.get(PermisosGuard);
    reflector = module.get(Reflector);
  });

  it('permite cuando no hay permisos requeridos en la ruta', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(null);
    const result = await guard.canActivate(
      makeCtx({ sub: 'op1', rol: 'operador', tenant: 'demo', tipo: 'institucional', permisos: [] }),
    );
    expect(result).toBe(true);
  });

  it('permite al superadmin independientemente de los permisos requeridos', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['casos.cerrar']);
    const result = await guard.canActivate(
      makeCtx({ sub: 'superadmin', rol: 'superadmin', tenant: null, tipo: 'institucional', permisos: [] }),
    );
    expect(result).toBe(true);
  });

  it('permite cuando el usuario tiene el permiso requerido', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['casos.ver']);
    const result = await guard.canActivate(
      makeCtx({ sub: 'op1', rol: 'operador', tenant: 'demo', tipo: 'institucional', permisos: [] }),
    );
    expect(result).toBe(true);
  });

  it('bloquea cuando el usuario no tiene el permiso requerido', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['casos.cerrar']);
    await expect(
      guard.canActivate(
        makeCtx({ sub: 'op1', rol: 'operador', tenant: 'demo', tipo: 'institucional', permisos: [] }),
      ),
    ).rejects.toThrow();
  });
});
