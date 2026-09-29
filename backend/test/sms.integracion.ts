/**
 * Prueba de integración del SMS: credenciales cifradas contra PostgreSQL real,
 * y los dos proveedores contra un servidor HTTP que captura EXACTAMENTE lo que
 * reciben.
 *
 * Por qué con un servidor de verdad y no con mocks: lo que puede estar mal aquí
 * es la forma de la petición —la cabecera de autorización, la ruta, el cuerpo—
 * y un mock diría que sí a cualquier forma. Aquí se comprueba byte a byte.
 *
 * Infobip se prueba sobre HTTPS a propósito: el remitente fuerza https porque
 * por ahí viaja la API key, y relajarlo para que la prueba fuera más cómoda
 * sería empeorar el código real. Por eso el banco levanta un servidor TLS con
 * un certificado propio y se confía en él con NODE_EXTRA_CA_CERTS.
 *
 *   CERT_DIR=/ruta/con/prueba.crt DATABASE_URL=postgres://falcon_app:falcon@127.0.0.1:5432/falcon \
 *     NODE_EXTRA_CA_CERTS=$CERT_DIR/prueba.crt npx ts-node test/sms.integracion.ts
 */
import 'reflect-metadata';
import { createServer as createServerHttp, IncomingMessage, ServerResponse } from 'http';
import { createServer as createServerHttps } from 'https';
import { readFileSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ConfigSmsEntity } from '../src/sms/config-sms.entity';
import { SmsService } from '../src/sms/sms.service';
import { InfobipRemitente } from '../src/sms/infobip.remitente';
import { InalambriaRemitente } from '../src/sms/inalambria.remitente';
import { aE164 } from '../src/sms/sms.types';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

interface Recibido { ruta: string; cabeceras: Record<string, string | string[] | undefined>; cuerpo: string }

async function main(): Promise<number> {
  const recibidas: Recibido[] = [];
  let responderCon = 200;

  const manejar = (req: IncomingMessage, res: ServerResponse): void => {
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      recibidas.push({ ruta: req.url ?? '', cabeceras: req.headers, cuerpo });
      res.writeHead(responderCon, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  };

  const dirCert = process.env.CERT_DIR ?? '.';
  // 5641 con TLS para Infobip; 5640 en claro para Inalambria, que sí admite
  // que la instancia configure su propio host.
  const servidorTls = createServerHttps(
    { key: readFileSync(`${dirCert}/prueba.key`), cert: readFileSync(`${dirCert}/prueba.crt`) },
    manejar,
  );
  const servidor = createServerHttp(manejar);
  await new Promise<void>((r) => servidorTls.listen(5641, '127.0.0.1', r));
  await new Promise<void>((r) => servidor.listen(5640, '127.0.0.1', r));

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://falcon_app:falcon@127.0.0.1:5432/falcon',
    entities: [ConfigSmsEntity],
    synchronize: true,
    logging: false,
  });
  await ds.initialize();
  await ds.query(`DELETE FROM config_sms WHERE tenant = 'tunja'`);

  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'secreto-de-prueba' : undefined) } as unknown as ConfigService;
  const svc = new SmsService(
    ds.getRepository(ConfigSmsEntity), new InfobipRemitente(), new InalambriaRemitente(), config,
  );

  console.log('\n1) Normalización del número (lo que dicta el ciudadano)');
  afirmar(aE164('3001234567') === '+573001234567', 'celular de 10 dígitos → +57…');
  afirmar(aE164('300 123 4567') === '+573001234567', 'con espacios, igual');
  afirmar(aE164('+57 300 1234567') === '+573001234567', 'ya en internacional, se respeta');
  afirmar(aE164('573001234567') === '+573001234567', 'con indicativo sin el +');
  afirmar(aE164('123') === null, 'algo que no es un número se rechaza, no se manda al proveedor');

  console.log('\n2) Sin configuración NO se intenta enviar');
  const sinConfig = await svc.enviar('tunja', '3001234567', 'hola');
  afirmar(sinConfig === false, 'devuelve false en vez de lanzar: la videollamada tiene que poder seguir');
  afirmar(recibidas.length === 0, 'y no salió ninguna petición a la red');

  console.log('\n3) La credencial se guarda CIFRADA');
  await svc.guardar('tunja', {
    proveedor: 'INFOBIP', apiKey: 'CLAVE-SECRETA-123',
    baseUrl: '127.0.0.1:5641', sender: 'FALCON', activo: true,
  }, 'admin');

  const crudo: Array<{ apiKey: string }> = await ds.query(
    `SELECT "apiKey" FROM config_sms WHERE tenant = 'tunja'`);
  afirmar(!crudo[0].apiKey.includes('CLAVE-SECRETA-123'),
    'la clave NO está en claro en la base');
  afirmar(crudo[0].apiKey.startsWith('enc1:'), `está cifrada (${crudo[0].apiKey.slice(0, 12)}…)`);

  const visible = await svc.ver('tunja');
  afirmar(!JSON.stringify(visible).includes('CLAVE-SECRETA-123'),
    'y tampoco sale hacia el navegador');
  afirmar(visible.tieneApiKey === true, 'solo se informa que existe');

  console.log('\n4) Infobip recibe lo que espera');
  recibidas.length = 0;
  const okInfobip = await svc.enviar('tunja', '3001234567', 'Su enlace: https://x/video/abc');
  afirmar(okInfobip === true, 'el envío se reporta exitoso');
  const i = recibidas[0];
  afirmar(i?.ruta === '/sms/3/messages', `ruta ${i?.ruta}`);
  afirmar(i?.cabeceras['authorization'] === 'App CLAVE-SECRETA-123',
    'la cabecera lleva la clave DESCIFRADA, en el formato de Infobip');
  const cuerpoI = JSON.parse(i?.cuerpo ?? '{}');
  afirmar(cuerpoI.messages?.[0]?.destinations?.[0]?.to === '+573001234567',
    'el destino va normalizado a E.164');
  afirmar(cuerpoI.messages?.[0]?.from === 'FALCON', 'y el remitente configurado');

  console.log('\n5) Cambiar de proveedor sin volver a escribir la clave');
  await svc.guardar('tunja', { proveedor: 'INALAMBRIA_EXPRESS', baseUrl: 'http://127.0.0.1:5640' }, 'admin');
  const trasCambio = await svc.ver('tunja');
  afirmar(trasCambio.tieneApiKey === true,
    'editar el proveedor con la clave vacía NO borra la credencial guardada');

  recibidas.length = 0;
  const okInal = await svc.enviar('tunja', '3009998877', 'prueba');
  afirmar(okInal === true, 'ahora envía por Inalambria');
  const n = recibidas[0];
  afirmar(n?.ruta === '/messages/send', `ruta ${n?.ruta}`);
  afirmar(n?.cabeceras['authorization'] === 'Bearer CLAVE-SECRETA-123',
    'con Bearer, que es lo que pide Inalambria');
  const cuerpoN = JSON.parse(n?.cuerpo ?? '{}');
  afirmar(cuerpoN.recipients?.[0] === '+573009998877' && cuerpoN.async === false,
    'destino normalizado y envío síncrono, para saber si de verdad salió');

  console.log('\n6) Si el proveedor rechaza, se reporta false (no se lanza)');
  responderCon = 401;
  const rechazado = await svc.enviar('tunja', '3001234567', 'x');
  afirmar(rechazado === false, 'un 401 del proveedor devuelve false');
  responderCon = 200;

  console.log('\n7) Desactivar corta el envío sin borrar nada');
  await svc.guardar('tunja', { activo: false }, 'admin');
  recibidas.length = 0;
  const desactivado = await svc.enviar('tunja', '3001234567', 'x');
  afirmar(desactivado === false && recibidas.length === 0, 'no sale petición con la config desactivada');
  afirmar((await svc.ver('tunja')).tieneApiKey === true, 'y la credencial sigue guardada');

  console.log('\n8) Aislamiento entre instancias');
  const otra = await svc.enviar('mebog', '3001234567', 'x');
  afirmar(otra === false, 'otra instancia sin configurar no hereda la de Tunja');

  await ds.destroy();
  servidor.close();
  servidorTls.close();

  console.log(fallos.length === 0
    ? '\n────────── TODO EN VERDE ──────────'
    : `\n────────── ${fallos.length} FALLO(S) ──────────\n  - ${fallos.join('\n  - ')}`);
  return fallos.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
