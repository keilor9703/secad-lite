import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePoliciaMfa } from '@policia/mfa';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Doble autenticación institucional reutilizada del SECAD (misma librería).
    providePoliciaMfa({
      apiBaseUrl: environment.apiBaseUrl,
      issuer: 'SECAD Lite',
      deviceStorageKey: 'secadlite_mfa_device',
    }),
  ],
};
