import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Restringe un handler a ciertos roles reservados (p. ej. 'superadmin').
 * Para autorización de features úsese @Permisos() (RBAC dinámico).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
