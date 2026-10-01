export const environment = {
  production: false,
  /** Base de la API NestJS del FALCON CAD. */
  apiBaseUrl: 'http://localhost:3000/api',
  /** Tenant activo (municipio). En el SaaS real se resuelve por subdominio/login. */
  /** Origen del canal en vivo (Socket.IO). Vacío = el mismo de la página. */
  wsBaseUrl: '',
  tenant: 'demo',


  // El servidor TURN NO se configura aquí: vive en /config/runtime.json, que
  // nginx sirve desde el despliegue. Ver core/config-runtime.ts y
  // docs/MIGRACION.md. Tenerlo en el código dejaba la credencial escrita en el
  // repositorio y obligaba a recompilar el frontend para cambiar de servidor.
};
