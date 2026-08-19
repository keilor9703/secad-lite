/**
 * Configuración del paquete publicado (reemplaza a environment.ts al construir
 * con --configuration production; ver fileReplacements en angular.json).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO ÚNICO QUE HAY QUE CAMBIAR AL DESPLEGAR: ORIGEN_API, la URL pública del
 * backend, SIN barra final. Por ejemplo:
 *
 *     const ORIGEN_API = 'https://falcon-cad-api.onrender.com';
 *
 * Al ponerla, el navegador habla directo con el backend, así que hay que
 * listar el dominio del frontend en la variable CORS_ORIGINS del backend.
 *
 * Si se deja vacía, la aplicación llama a `/api` en su propio origen, lo que
 * exige una reescritura hacia el backend en vercel.json. Sirve, pero el aviso
 * de llamada entrante queda inactivo: una reescritura de Vercel no reenvía
 * websockets. Ver docs/despliegue-demo.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

//const ORIGEN_API = 'https://secad-lite.onrender.com';
const ORIGEN_API = 'https://falcon-test.appjeylor.com'; 
export const environment = {
  production: true,
  apiBaseUrl: ORIGEN_API ? `${ORIGEN_API}/api` : '/api',
  /**
   * Origen del canal en vivo (Socket.IO) de la planta telefónica. Tiene que ser
   * la URL absoluta del backend; vacío deja el aviso de llamada entrante
   * inactivo, sin romper el resto de la aplicación.
   */
  wsBaseUrl: ORIGEN_API,
  tenant: 'demo',
};
