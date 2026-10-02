import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238) y Base32 (RFC 4648), sin dependencias externas.
 *
 * Escrito a mano y no con una librería a propósito: son treinta líneas, van en
 * el camino de autenticación de un sistema de emergencias, y el RFC publica
 * vectores de prueba oficiales — así que se puede demostrar que es correcto en
 * vez de confiar en que lo sea. Una dependencia aquí es superficie de ataque de
 * cadena de suministro a cambio de muy poco.
 *
 * Parámetros fijos en SHA-1, 6 dígitos y 30 segundos: no por ser los mejores,
 * sino porque son los que TODA aplicación de autenticación entiende sin
 * configurar nada —Google Authenticator, Microsoft Authenticator, Authy, 1Password,
 * FreeOTP—. Cambiarlos rompería a los usuarios sin ganar nada práctico.
 */
export const DIGITOS = 6;
export const PERIODO_S = 30;

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica a Base32 sin relleno, que es lo que acepta el URI `otpauth://`. */
export function aBase32(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_B32[(valor << (5 - bits)) & 31];
  return salida;
}

/**
 * Decodifica Base32. Tolera minúsculas, espacios y el relleno `=`, porque el
 * usuario puede teclear la clave manual copiándola de la pantalla.
 */
export function deBase32(texto: string): Buffer {
  const limpio = (texto ?? '').toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO_B32.indexOf(c);
    if (i < 0) throw new Error('La clave no es Base32 válida.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo. 20 bytes = 160 bits, el tamaño que indica el RFC para SHA-1. */
export function generarSecreto(): string {
  return aBase32(randomBytes(20));
}

/** El código de ese contador. Público para poder probarlo contra el RFC. */
export function codigoDeContador(secreto: string, contador: number): string {
  const buffer = Buffer.alloc(8);
  // El contador es de 64 bits; JavaScript no tiene enteros de 64 bits en
  // `number`, así que se parte en dos mitades de 32.
  buffer.writeUInt32BE(Math.floor(contador / 2 ** 32), 0);
  buffer.writeUInt32BE(contador >>> 0, 4);

  const hmac = createHmac('sha1', deBase32(secreto)).update(buffer).digest();

  // Truncamiento dinámico (RFC 4226 §5.3): los 4 bits bajos del último byte
  // dicen desde dónde leer, y el bit más alto se descarta para que el número
  // salga siempre positivo.
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[desplazamiento] & 0x7f) << 24) |
    (hmac[desplazamiento + 1] << 16) |
    (hmac[desplazamiento + 2] << 8) |
    hmac[desplazamiento + 3];

  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

/** El contador que corresponde a un instante. */
export function contadorDe(momento: Date = new Date()): number {
  return Math.floor(momento.getTime() / 1000 / PERIODO_S);
}

/**
 * ¿Es válido este código? Devuelve el contador que lo validó, o `null`.
 *
 * Se devuelve el contador —y no un simple sí/no— para que quien llama pueda
 * guardarlo y rechazar ese mismo código si se vuelve a presentar: sin eso, un
 * código interceptado sirve durante el minuto y medio de la ventana. Es la
 * diferencia entre un código de un solo uso y uno reutilizable.
 *
 * Ventana de ±1 paso (90 segundos en total). El RFC recomienda admitir como
 * mucho un paso por el retardo de la red; el paso hacia adelante cubre además
 * el reloj adelantado del teléfono, que en la práctica es lo que más falla.
 */
export function verificarCodigo(
  secreto: string,
  codigo: string,
  momento: Date = new Date(),
  pasos = 1,
): number | null {
  const limpio = (codigo ?? '').replace(/\D+/g, '');
  if (limpio.length !== DIGITOS) return null;

  const actual = contadorDe(momento);
  for (let d = -pasos; d <= pasos; d++) {
    const contador = actual + d;
    if (contador < 0) continue;
    // Comparación en tiempo constante: comparar códigos con `===` filtra por
    // cuántos dígitos iniciales coinciden. Con seis dígitos el margen es
    // pequeño, pero no cuesta nada cerrarlo.
    const esperado = Buffer.from(codigoDeContador(secreto, contador));
    const recibido = Buffer.from(limpio);
    if (esperado.length === recibido.length && timingSafeEqual(esperado, recibido)) {
      return contador;
    }
  }
  return null;
}

/**
 * URI `otpauth://` que la aplicación de autenticación lee del QR.
 *
 * La etiqueta es «Emisor:cuenta» y lleva ADEMÁS el parámetro `issuer`: las
 * aplicaciones usan uno u otro según la versión, y poner los dos es lo que
 * evita que la cuenta aparezca sin nombre o duplicada.
 */
export function uriOtpauth(emisor: string, cuenta: string, secreto: string): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const parametros = new URLSearchParams({
    secret: secreto,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PERIODO_S),
  });
  return `otpauth://totp/${etiqueta}?${parametros.toString()}`;
}
