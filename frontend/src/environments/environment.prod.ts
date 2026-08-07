/**
 * Configuración del paquete publicado (la reemplaza al construir con
 * --configuration production; ver fileReplacements en angular.json).
 *
 * `apiBaseUrl` es relativo a propósito: en el despliegue, `/api` se redirige al
 * backend desde vercel.json, de modo que el navegador ve un solo origen y no
 * hay que lidiar con CORS ni con contenido mixto. Si prefiere apuntar directo
 * al backend, ponga aquí su URL https completa y habilite CORS allá.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  /**
   * Origen del canal en vivo (Socket.IO) de la planta telefónica. Debe ser la
   * URL absoluta del backend: una reescritura de Vercel no reenvía websockets,
   * así que este es el único camino que no pasa por el proxy. Vacío deja el
   * aviso de llamada entrante inactivo, sin romper el resto de la aplicación.
   */
  wsBaseUrl: '',
  tenant: 'demo',
};
