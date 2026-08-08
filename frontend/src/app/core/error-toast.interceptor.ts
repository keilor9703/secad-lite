import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../shared/toast/toast.service';

/** El login ya muestra su propio error justo bajo el formulario; un toast ahí sería ruido duplicado. */
const SILENCIOSAS = ['/auth/login', '/auth/civil/login'];

/**
 * Avisa con un toast cualquier petición que el backend rechace, además del
 * manejo puntual que ya haga cada página. Así ningún "no se pudo" pasa
 * inadvertido, ni siquiera en páginas largas (Administración, Catálogos)
 * donde el mensaje inline puede quedar fuera de la vista actual.
 */
export const errorToastInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (!SILENCIOSAS.some((s) => req.url.includes(s))) {
        toast.error(mensajeDe(err));
      }
      return throwError(() => err);
    }),
  );
};

function mensajeDe(err: HttpErrorResponse): string {
  const msg = err?.error?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg) && msg.length) return String(msg[0]);
  switch (err?.status) {
    case 0: return 'Sin conexión con el servidor.';
    case 401: return 'Su sesión no es válida o expiró.';
    case 403: return 'No tiene permisos para esta acción.';
    case 404: return 'No se encontró el recurso solicitado.';
    default: return 'Ocurrió un error al procesar la solicitud.';
  }
}
