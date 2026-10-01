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
   * Origen del canal en vivo (Socket.IO) de la planta telefónica. Tiene que ser
   * la URL absoluta del backend; vacío deja el aviso de llamada entrante
   * inactivo, sin romper el resto de la aplicación.
   */
  wsBaseUrl: ORIGEN_API,
  tenant: 'demo',


  // El servidor TURN NO se configura aquí: vive en /config/runtime.json, que
  // nginx sirve desde el despliegue. Ver core/config-runtime.ts y
  // docs/MIGRACION.md. Tenerlo en el código dejaba la credencial escrita en el
  // repositorio y obligaba a recompilar el frontend para cambiar de servidor.
};
