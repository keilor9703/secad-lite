export const environment = {
  production: false,
  /** Base de la API NestJS del FALCON CAD. */
  apiBaseUrl: 'http://localhost:3000/api',
  /** Tenant activo (municipio). En el SaaS real se resuelve por subdominio/login. */
  /** Origen del canal en vivo (Socket.IO). Vacío = el mismo de la página. */
  wsBaseUrl: '',
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
