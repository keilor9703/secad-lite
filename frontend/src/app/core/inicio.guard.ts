import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Aterrizaje según el trabajo de cada quien: al entrar, el sistema lleva a la
 * pantalla donde esa persona opera, en vez de a una bandeja genérica que no le
 * dice qué hacer. El orden va de lo más operativo a lo más administrativo.
 */
export const inicioGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const sesion = auth.sesion();

  if (sesion?.tipo === 'civil') return router.parseUrl('/chat');
  if (auth.esSuperadmin()) return router.parseUrl('/plataforma');

  // Quien recepciona entra por Recepción; quien solo despacha, al tablero.
  // 'casos.ver' NO basta para mandar a Despacho: lo comparten Recepción,
  // Consulta y Catálogos — el permiso propio de Despacho es 'despacho.ver'.
  if (auth.tienePermiso('casos.crear')) return router.parseUrl('/recepcion');
  if (auth.tienePermiso('despacho.ver')) return router.parseUrl('/despacho');
  if (auth.tienePermiso('metricas.ver')) return router.parseUrl('/dashboard');
  if (auth.esAdmin()) return router.parseUrl('/admin');
  return router.parseUrl('/casos');
};
