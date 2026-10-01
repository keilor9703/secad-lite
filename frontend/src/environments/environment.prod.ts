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
 * Si se deja vacía, la aplicación llama a `/api` en su propio origen —lo que
 * corresponde cuando nginx sirve frontend y API bajo el mismo dominio, como
 * en el despliegue de un solo servidor—. El canal en vivo (Socket.IO) también
 * usa ese mismo origen por ruta relativa y funciona igual: nginx reenvía
 * websockets sin problema con la configuración de `proxy_pass` habitual. Solo
 * hace falta `ORIGEN_API` cuando la API vive en un dominio DISTINTO al del
 * frontend (p. ej. Vercel + Render) — ahí sí hace falta la URL absoluta,
 * porque una reescritura de hosting estático no reenvía websockets. Ver
 * docs/despliegue-demo.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

// VACÍO = la API se llama en el MISMO origen que sirve la página, con rutas
// relativas (`/api`). Es lo que corresponde cuando nginx publica el frontend y
// hace de proxy a la API bajo el mismo dominio, y tiene tres consecuencias
// buenas: no hay CORS que configurar, el mismo artefacto compilado sirve para
// falcon-test y para producción, y no queda un dominio horneado en el bundle
// que haya que recordar cambiar antes de cada despliegue.
//
// Poner aquí un origen SOLO si la API vive en otro dominio que el frontend; en
// ese caso hay que declarar ese dominio en CORS_ORIGINS del backend.
const ORIGEN_API = '';
export const environment = {
  production: true,
  apiBaseUrl: ORIGEN_API ? `${ORIGEN_API}/api` : '/api',
  /**
   * Origen del canal en vivo (Socket.IO): PBX, casos en vivo, chat interno y
   * videollamada. Vacío = mismo origen que la página (ruta relativa, lo
   * correcto con nginx proxy de un solo servidor); con valor, URL absoluta
   * del backend (API y frontend en dominios distintos).
   */
  wsBaseUrl: ORIGEN_API,
  tenant: 'demo',


  // El servidor TURN NO se configura aquí: vive en /config/runtime.json, que
  // nginx sirve desde el despliegue. Ver core/config-runtime.ts y
  // docs/MIGRACION.md. Tenerlo en el código dejaba la credencial escrita en el
  // repositorio y obligaba a recompilar el frontend para cambiar de servidor.
};
