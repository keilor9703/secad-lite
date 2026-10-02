/**
 * TOTP contra los vectores de prueba OFICIALES del RFC 6238 (Apéndice B).
 *
 * Es la única forma honesta de verificar una implementación criptográfica:
 * no «me devuelve seis dígitos», sino «devuelve EXACTAMENTE los dígitos que
 * el estándar dice que debe devolver para ese secreto y ese instante». Si
 * estos veinte números coinciden, cualquier aplicación de autenticación del
 * mundo va a entenderse con Falcon.
 *
 *   npx ts-node test/totp.prueba.ts
 */
import {
  aBase32, deBase32, codigoDeContador, contadorDe, generarSecreto,
  uriOtpauth, verificarCodigo, PERIODO_S,
} from '../src/auth/mfa/totp';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

// El RFC usa el secreto ASCII "12345678901234567890" (20 bytes).
const SECRETO_RFC = aBase32(Buffer.from('12345678901234567890', 'ascii'));

/** [segundos desde epoch, código esperado] — RFC 6238, Apéndice B, SHA-1. */
const VECTORES: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

console.log('\n1. Vectores oficiales del RFC 6238 (SHA-1, 6 dígitos, 30 s)');
for (const [segundos, esperado] of VECTORES) {
  const contador = Math.floor(segundos / PERIODO_S);
  const obtenido = codigoDeContador(SECRETO_RFC, contador);
  afirmar(obtenido === esperado, `t=${segundos} → ${esperado} (obtenido ${obtenido})`);
}

console.log('\n2. Base32 ida y vuelta (RFC 4648)');
// Vectores del RFC 4648 §10.
const B32: [string, string][] = [
  ['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'],
  ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI'],
];
for (const [claro, b32] of B32) {
  afirmar(aBase32(Buffer.from(claro, 'ascii')) === b32, `"${claro}" → ${b32 || '(vacío)'}`);
}
afirmar(deBase32('MZXW6YTBOI').toString('ascii') === 'foobar', 'decodifica de vuelta');
afirmar(deBase32('mzxw6ytboi').toString('ascii') === 'foobar', 'tolera minúsculas');
afirmar(deBase32('MZXW 6YTB OI==').toString('ascii') === 'foobar', 'tolera espacios y relleno');

console.log('\n3. Verificación: ventana, formato y reutilización');
const ahora = new Date(1700000000000);
const codigoAhora = codigoDeContador(SECRETO_RFC, contadorDe(ahora));
afirmar(verificarCodigo(SECRETO_RFC, codigoAhora, ahora) === contadorDe(ahora),
  'acepta el código del momento y dice qué contador lo validó');
afirmar(verificarCodigo(SECRETO_RFC, ` ${codigoAhora} `, ahora) !== null,
  'tolera espacios alrededor');

const hace30 = new Date(ahora.getTime() - 30_000);
const en30 = new Date(ahora.getTime() + 30_000);
afirmar(verificarCodigo(SECRETO_RFC, codigoDeContador(SECRETO_RFC, contadorDe(hace30)), ahora) !== null,
  'acepta el código anterior (reloj atrasado o red lenta)');
afirmar(verificarCodigo(SECRETO_RFC, codigoDeContador(SECRETO_RFC, contadorDe(en30)), ahora) !== null,
  'acepta el código siguiente (reloj del teléfono adelantado)');

const hace90 = new Date(ahora.getTime() - 90_000);
afirmar(verificarCodigo(SECRETO_RFC, codigoDeContador(SECRETO_RFC, contadorDe(hace90)), ahora) === null,
  'RECHAZA un código de hace 90 segundos');
const en90 = new Date(ahora.getTime() + 90_000);
afirmar(verificarCodigo(SECRETO_RFC, codigoDeContador(SECRETO_RFC, contadorDe(en90)), ahora) === null,
  'RECHAZA un código de dentro de 90 segundos');

afirmar(verificarCodigo(SECRETO_RFC, '', ahora) === null, 'rechaza vacío');
afirmar(verificarCodigo(SECRETO_RFC, '12345', ahora) === null, 'rechaza 5 dígitos');
afirmar(verificarCodigo(SECRETO_RFC, '1234567', ahora) === null, 'rechaza 7 dígitos');
afirmar(verificarCodigo(SECRETO_RFC, 'abcdef', ahora) === null, 'rechaza letras');
afirmar(verificarCodigo(SECRETO_RFC, '000000', ahora) === null, 'rechaza un código que no es');

console.log('\n4. Secretos y URI');
const s1 = generarSecreto(), s2 = generarSecreto();
afirmar(s1.length === 32, `el secreto son 32 caracteres Base32 = 160 bits (${s1.length})`);
afirmar(s1 !== s2, 'dos secretos seguidos son distintos');
afirmar(/^[A-Z2-7]+$/.test(s1), 'solo usa el alfabeto Base32');

const uri = uriOtpauth('FALCON CAD', 'maria.gomez@envigado', s1);
afirmar(uri.startsWith('otpauth://totp/'), 'el URI es otpauth://totp/');
afirmar(uri.includes(`secret=${s1}`), 'lleva el secreto');
afirmar(uri.includes('issuer=FALCON+CAD'), 'lleva el emisor como parámetro');
// La etiqueta es «Emisor:cuenta» con los dos puntos LITERALES, que es la
// forma que leen las aplicaciones; lo que va escapado es cada parte.
afirmar(uri.includes('FALCON%20CAD:maria.gomez%40envigado'), 'y también en la etiqueta, con cada parte escapada');
afirmar(uri.includes('algorithm=SHA1') && uri.includes('digits=6') && uri.includes('period=30'),
  'declara los parámetros que toda aplicación entiende');

// Un secreto recién generado tiene que funcionar de extremo a extremo: es lo
// que de verdad va a pasar cuando un operador escanee el QR.
const codigoReal = codigoDeContador(s1, contadorDe());
afirmar(verificarCodigo(s1, codigoReal) !== null, 'un secreto nuevo valida su propio código');

console.log(fallos.length ? `\n✗ ${fallos.length} fallo(s):` : '\n✓ Todo bien');
fallos.forEach((f) => console.log(`   - ${f}`));
process.exit(fallos.length ? 1 : 0);
