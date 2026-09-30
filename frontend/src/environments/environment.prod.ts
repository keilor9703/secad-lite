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

  // Servidor TURN propio (coturn), el MISMO que ya usa SECAD en este servidor.
  // Hace falta para que la videollamada atraviese el NAT simétrico de los
  // operadores celulares: sin él solo queda STUN y la llamada se queda en negro
  // en buena parte de las redes móviles.
  //
  // La credencial queda visible en el bundle público — es inevitable, el
  // navegador la necesita para autenticar el ALLOCATE— y es el mismo riesgo ya
  // asumido en SECAD. Para endurecerlo: coturn con `use-auth-secret` y un
  // endpoint que emita credenciales efímeras por HMAC.
  turnUrls: ['turn:129.80.243.118:3478?transport=udp', 'turn:129.80.243.118:3478?transport=tcp'],
  turnUsername: 'secad',
  turnCredential: '6KpIEJuDnU/gzWJiDztD0UFiaUUYAn98',
};
