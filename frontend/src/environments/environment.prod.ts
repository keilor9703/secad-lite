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
  tenant: 'demo',
};
