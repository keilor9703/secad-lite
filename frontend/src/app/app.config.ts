import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { errorToastInterceptor } from './core/error-toast.interceptor';
import { ManejadorErrores } from './core/manejador-errores';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, errorToastInterceptor])),
    // Deja rastro de las excepciones del navegador para el reporte de soporte.
    { provide: ErrorHandler, useClass: ManejadorErrores },
  ],
};
