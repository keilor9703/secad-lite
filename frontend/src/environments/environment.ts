export const environment = {
  production: false,
  /** Base de la API NestJS del FALCON CAD. */
  apiBaseUrl: 'http://localhost:3000/api',
  /** Tenant activo (municipio). En el SaaS real se resuelve por subdominio/login. */
  /** Origen del canal en vivo (Socket.IO). Vacío = el mismo de la página. */
  wsBaseUrl: '',
  tenant: 'demo',
};
