import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

/**
 * Adjunta el token y el tenant a cada petición a la API. Con sesión abierta el
 * tenant es el efectivo (el propio, o el que el superadmin tenga en gestión);
 * si el superadmin aún no ha elegido ninguno no se manda header y el backend
 * responde pidiéndolo, en vez de resolver a una instancia cualquiera.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token;
  const tenant = auth.sesion() ? auth.tenantActivo() : environment.tenant;

  const headers: Record<string, string> = {};
  if (tenant) headers['X-Tenant-Id'] = tenant;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return next(req.clone({ setHeaders: headers }));
};
