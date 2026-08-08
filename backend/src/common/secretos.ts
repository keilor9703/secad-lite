import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Protección de secretos en reposo.
 *
 * - API keys (tenant / entidad externa): NO se guardan; se guarda su digest
 *   SHA-256 y se compara por digest. Una copia de la base no revela ninguna
 *   clave utilizable — el texto claro solo existe el instante en que se
 *   genera, y se muestra una única vez.
 * - Tokens que el sistema sí necesita reusar (el access token de WhatsApp):
 *   cifrados con AES-256-GCM usando una llave derivada de JWT_SECRET.
 */

/** Digest hex de una API key, para guardarla y buscarla sin conocerla. */
export function digestApiKey(key: string): string {
  return createHash('sha256').update(key.trim()).digest('hex');
}

/** ¿El valor almacenado ya es un digest (64 hex) y no una clave en claro? */
export function esDigest(valor: string | null | undefined): boolean {
  return !!valor && /^[0-9a-f]{64}$/.test(valor);
}

const PREFIJO_CIFRADO = 'enc1:';

function llaveDe(secreto: string): Buffer {
  return createHash('sha256').update(`falconcad:${secreto}`).digest();
}

/** Cifra un texto reutilizable (AES-256-GCM). Devuelve `enc1:<iv>:<tag>:<datos>`. */
export function cifrar(texto: string, secreto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', llaveDe(secreto), iv);
  const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${PREFIJO_CIFRADO}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${datos.toString('hex')}`;
}

/**
 * Descifra un valor guardado. Un valor sin el prefijo se devuelve tal cual:
 * es un token anterior a este cambio, que se re-cifrará la próxima vez que
 * el administrador lo guarde.
 */
export function descifrar(valor: string, secreto: string): string {
  if (!valor.startsWith(PREFIJO_CIFRADO)) return valor;
  const [iv, tag, datos] = valor.slice(PREFIJO_CIFRADO.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', llaveDe(secreto), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(datos, 'hex')), decipher.final()]).toString('utf8');
}
