import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { cargarConfigRuntime } from './app/core/config-runtime';

// La configuración del servidor se lee ANTES de arrancar: así ningún
// componente puede encontrársela a medio cargar. Nunca falla —si el archivo
// no está, se sigue con los valores por defecto—, de modo que esto no agrega
// una forma nueva de que la aplicación no abra.
cargarConfigRuntime().finally(() => {
  bootstrapApplication(App, appConfig)
    .catch((err) => console.error(err));
});
