import { Request } from 'express';

/** Un nombre de host con puerto opcional, y nada más. */
const HOST_VALIDO = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

/** Donde el enlace puede seguir siendo `http://`: solo el desarrollo local. */
const LOCALES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * El origen público por el que llegó ESTA petición — `https://dominio.tld`.
 *
 * Existe para que un despliegue normal no tenga que configurar nada: detrás de
 * nginx, el contenedor por dentro solo se llama `backend1` y no puede adivinar
 * el dominio con el que lo alcanzan desde afuera, pero el proxy sí se lo dice
 * en `X-Forwarded-Host` / `X-Forwarded-Proto`. Con `trust proxy` puesto (ver
 * main.ts), Express ya resuelve esas cabeceras en `req.hostname` y
 * `req.protocol`.
 *
 * QUÉ TAN CONFIABLE ES: el reverse proxy REESCRIBE esas cabeceras en cada
 * petición que entra de la calle, así que un cliente no las controla. Solo
 * quien ya esté dentro de la red interna podría forjarlas —los contenedores no
 * publican su puerto al host—, y para eso ya hace falta haber entrado. Es
 * incomparable con aceptar el dominio en el cuerpo de la petición, que
 * cualquier funcionario con sesión podría cambiar.
 *
 * Aun así, quien quiera certeza fija `FRONTEND_URL` y esto no se consulta: la
 * configuración del servidor siempre manda sobre lo deducido.
 *
 * El esquema se fuerza a https fuera de local a propósito: la página del
 * ciudadano pide cámara y micrófono, y ningún navegador los entrega en una
 * página http. Un enlace http no sería «menos seguro», sería inservible.
 */
export function origenPublico(req: Request | undefined): string | null {
  // Se leen las cabeceras en crudo y no `req.hostname` porque esa propiedad
  // DESCARTA el puerto, y en desarrollo el frontend vive en otro (`:4200`).
  // `X-Forwarded-Host` puede traer una lista si hubo varios saltos: manda el
  // primero, que es el que vio el cliente.
  const reenviado = req?.headers['x-forwarded-host'];
  const crudo = Array.isArray(reenviado) ? reenviado[0] : reenviado;
  const host = (crudo ?? req?.headers.host ?? '').split(',')[0].trim();
  if (!host || !HOST_VALIDO.test(host)) return null;

  const esLocal = LOCALES.includes(host.split(':')[0]);
  const esquema = esLocal ? (req?.protocol === 'https' ? 'https' : 'http') : 'https';
  return `${esquema}://${host}`;
}
