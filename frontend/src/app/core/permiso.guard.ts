import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guard por módulo: la ruta solo se activa si el rol tiene ALGUNO de los
 * permisos indicados. Sin él, escribir la URL a mano bastaba para entrar a la
 * interfaz de un módulo que la barra de navegación ocultaba (el backend
 * seguía mandando en los datos, pero el modelo de módulos quedaba incoherente).
 * Sin permiso se vuelve al inicio, que ya elige la página según el rol.
 */
export const permisoGuard = (...claves: string[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (claves.some((c) => auth.tienePermiso(c))) return true;
  return router.parseUrl('/');
};

/** Solo el dueño de la plataforma (rol reservado superadmin). */
export const superadminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.esSuperadmin() ? true : router.parseUrl('/');
};
