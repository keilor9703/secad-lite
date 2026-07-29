import { SetMetadata } from '@nestjs/common';
import { Rol } from '../usuarios/usuario.entity';

export const ROLES_KEY = 'roles';

/** Restringe un handler a ciertos roles. Sin este decorador, cualquier rol autenticado pasa. */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_KEY, roles);
