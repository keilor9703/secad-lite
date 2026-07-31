import { SetMetadata } from '@nestjs/common';

export const PERMISOS_KEY = 'permisos';

/**
 * Exige que el usuario tenga TODOS los permisos indicados (RBAC dinámico).
 * El superadmin los tiene todos por definición (lo resuelve el PermisosGuard).
 */
export const Permisos = (...permisos: string[]) => SetMetadata(PERMISOS_KEY, permisos);
