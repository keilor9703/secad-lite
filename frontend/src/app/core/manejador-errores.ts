import { ErrorHandler, Injectable } from '@angular/core';
import { registrarErrorJs } from './registro-errores';

/**
 * Anota en el registro de diagnóstico cualquier excepción que llegue al
 * manejador global de Angular, y después la deja seguir a la consola.
 *
 * El `provideBrowserGlobalErrorListeners()` de `app.config.ts` ya encamina
 * hacia aquí también lo que revienta fuera de Angular (`window.onerror`) y las
 * promesas sin `catch`, así que con esto el reporte de soporte lleva las tres
 * clases de fallo del navegador sin enganchar nada más.
 *
 * NO se traga el error: sigue apareciendo en la consola igual que antes. Un
 * manejador que silencia es peor que no tener manejador — el desarrollador
 * pierde la pila y el operador pierde el aviso.
 */
@Injectable()
export class ManejadorErrores implements ErrorHandler {
  handleError(error: unknown): void {
    // El registro nunca puede ser la causa de un error: si fallara, el fallo
    // original quedaría tapado por el del registro.
    try {
      registrarErrorJs(error);
    } catch { /* el registro no estorba */ }
    console.error(error);
  }
}
