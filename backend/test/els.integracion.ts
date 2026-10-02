/**
 * Prueba de integración de la geolocalización ELS contra un servidor HTTP real
 * que captura EXACTAMENTE lo que recibe.
 *
 * Con un servidor y no con mocks por lo mismo que en sms.integracion.ts: lo que
 * puede estar mal aquí es la FORMA de la petición —el método, la ruta con la
 * agencia dentro, la autorización básica, los parámetros— y un mock diría que
 * sí a cualquier forma.
 *
 * No necesita base de datos: el repositorio se sustituye por una fila en
 * memoria. Lo que se prueba es el servicio, no TypeORM.
 *
 *   npx ts-node test/els.integracion.ts
 */
import 'reflect-metadata';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ConfigElsEntity } from '../src/els/config-els.entity';
import { ElsService, TENANT_CONFIG_ELS } from '../src/els/els.service';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

const SECRETO = 'llave-de-prueba-para-cifrar-credenciales';

/** Repositorio en memoria con la misma superficie que usa el servicio. */

interface Recibido { metodo: string; ruta: string; autorizacion?: string }

async function main(): Promise<number> {
  const recibidas: Recibido[] = [];
  let estado = 200;
  let cuerpo = '{}';
  /** Segundos que tarda el banco en responder; para probar la espera agotada. */
  let demoraMs = 0;

  const manejar = (req: IncomingMessage, res: ServerResponse): void => {
    recibidas.push({
      metodo: req.method ?? '',
      ruta: req.url ?? '',
      autorizacion: req.headers.authorization,
    });
    const responder = (): void => {
      res.writeHead(estado, { 'content-type': 'application/json' });
      res.end(cuerpo);
    };
    if (demoraMs) setTimeout(responder, demoraMs);
    else responder();
  };

  const servidor = createServer(manejar);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${puerto}`;

  const config = { get: (k: string) => (k === 'JWT_SECRET' ? SECRETO : undefined) } as ConfigService;

  const caja: { fila: ConfigElsEntity | null } = { fila: null };
  const repo = {
    findOne: async () => caja.fila,
    create: (d: Partial<ConfigElsEntity>) => ({ ...d }) as ConfigElsEntity,
    save: async (c: ConfigElsEntity) => { caja.fila = c; return c; },
  } as unknown as Repository<ConfigElsEntity>;

  const els = new ElsService(repo, config);

  try {
    // ── 1. La credencial se guarda cifrada y no vuelve nunca ───────────────
    console.log('\n1. Guardar la configuración');
    const visible = await els.guardar(TENANT_CONFIG_ELS, {
      baseUrl: base, agencia: 'antioquia', clienteId: 'elUsuario',
      clienteSecreto: 'elSecreto', casoPorDefecto: 'abc123', activo: true,
    }, 'prueba');

    afirmar(visible.tieneSecreto === true, 'informa que hay un secreto guardado');
    afirmar(!JSON.stringify(visible).includes('elSecreto'), 'NO devuelve el secreto al navegador');
    afirmar(caja.fila?.clienteSecreto !== 'elSecreto'
      && (caja.fila?.clienteSecreto?.length ?? 0) > 10, 'lo guarda cifrado, no en claro');

    // ── 2. Guardar sin secreto conserva el que había ───────────────────────
    console.log('\n2. Editar sin reescribir el secreto');
    const cifradoAntes = caja.fila?.clienteSecreto;
    await els.guardar(TENANT_CONFIG_ELS, { agencia: 'valle' }, 'prueba');
    afirmar(caja.fila?.clienteSecreto === cifradoAntes, 'conserva el secreto al editar otro campo');
    afirmar(caja.fila?.agencia === 'valle', 'sí cambia lo que se mandó');
    await els.guardar(TENANT_CONFIG_ELS, { agencia: 'antioquia' }, 'prueba');

    // ── 3. La forma de la petición ─────────────────────────────────────────
    console.log('\n3. Forma de la petición al proveedor');
    cuerpo = JSON.stringify({ results: [{
      application: 'ELS', caller_id: '+573224445555',
      latitude: '6.2518', longitude: '-75.5636',
      location_time: 1783631673.4768913, source: 'CALL', case_id: 'abc123',
    }] });
    recibidas.length = 0;

    const u = await els.ubicar('(322) 444-5555');
    const r = recibidas[0];
    afirmar(r?.metodo === 'POST', 'usa POST, como dice la especificación');
    afirmar(r?.ruta.startsWith('/v1/rem/trigger/hook/antioquia/trigger'),
      'la agencia va dentro de la ruta');
    afirmar(r?.ruta.includes('caller_id=3224445555'),
      'manda el número solo con dígitos (quita espacios, guiones y paréntesis)');
    afirmar(r?.ruta.includes('case_id=abc123'), 'manda el case_id por defecto');
    afirmar(r?.autorizacion === 'Basic ' + Buffer.from('elUsuario:elSecreto').toString('base64'),
      'autorización básica con el secreto descifrado');

    afirmar(u?.lat === 6.2518 && u?.lng === -75.5636, 'devuelve las coordenadas como números');
    afirmar(u?.origen === 'CALL', 'conserva el origen que informa el proveedor');
    afirmar(u?.momento?.getUTCFullYear() === new Date(1783631673.4768913 * 1000).getUTCFullYear(),
      'convierte el instante de segundos a fecha');

    // ── 4. El case_id del caso pisa al de por defecto ──────────────────────
    console.log('\n4. case_id de un caso real');
    recibidas.length = 0;
    await els.ubicar('3224445555', 'CASO-77');
    afirmar(recibidas[0]?.ruta.includes('case_id=CASO-77'), 'usa el caso cuando se le da uno');

    // ── 5. Lo que NO debe poner un punto en el mapa ────────────────────────
    // Esta es la sección que de verdad importa: una coordenada inventada
    // mandaría una patrulla a otro sitio. Peor que no tener ninguna.
    console.log('\n5. Respuestas que no deben producir ubicación');

    estado = 404;
    afirmar(await els.ubicar('3224445555') === null, '404 (el teléfono no reporta) → sin ubicación');

    estado = 500;
    afirmar(await els.ubicar('3224445555') === null, '500 del proveedor → sin ubicación');

    estado = 200;
    const basura: [string, string][] = [
      ['{"results":[]}', 'lista vacía'],
      ['{"results":[{"latitude":"","longitude":""}]}', 'coordenadas vacías'],
      ['{"results":[{"latitude":"N/A","longitude":"N/A"}]}', 'coordenadas no numéricas'],
      ['{"results":[{"latitude":"0","longitude":"0"}]}', 'isla nula (0,0)'],
      ['{"results":[{"latitude":"91","longitude":"-75"}]}', 'latitud fuera de rango'],
      ['{"results":[{"latitude":"6.25","longitude":"181"}]}', 'longitud fuera de rango'],
      ['{"nada":1}', 'respuesta sin results'],
      ['no es json', 'respuesta que no es JSON'],
    ];
    for (const [c, nombre] of basura) {
      cuerpo = c;
      afirmar(await els.ubicar('3224445555') === null, `${nombre} → sin ubicación`);
    }

    // ── 6. Sin configuración y desactivada ─────────────────────────────────
    console.log('\n6. Configuración ausente o apagada');
    cuerpo = JSON.stringify({ results: [{ latitude: '6.25', longitude: '-75.56' }] });
    recibidas.length = 0;
    await els.guardar(TENANT_CONFIG_ELS, { activo: false }, 'prueba');
    afirmar(await els.ubicar('3224445555') === null, 'desactivada → sin ubicación');
    afirmar(recibidas.length === 0, 'desactivada → NI SIQUIERA consulta al proveedor');

    await els.guardar(TENANT_CONFIG_ELS, { activo: true }, 'prueba');
    caja.fila = { ...(caja.fila as ConfigElsEntity), clienteSecreto: null };
    recibidas.length = 0;
    afirmar(await els.ubicar('3224445555') === null, 'sin credencial → sin ubicación');
    afirmar(recibidas.length === 0, 'sin credencial → no consulta');

    // ── 7. Teléfono inservible ─────────────────────────────────────────────
    console.log('\n7. Teléfono vacío');
    await els.guardar(TENANT_CONFIG_ELS, { clienteSecreto: 'elSecreto' }, 'prueba');
    recibidas.length = 0;
    afirmar(await els.ubicar('') === null, 'teléfono vacío → sin ubicación');
    afirmar(await els.ubicar('sin dígitos') === null, 'teléfono sin dígitos → sin ubicación');
    afirmar(recibidas.length === 0, 'no gasta una consulta con un número inservible');

    // ── 8. El proveedor que no contesta ────────────────────────────────────
    // El operador está con una emergencia al teléfono: la recepción no puede
    // quedarse colgada esperando. Tarda ~6 s a propósito.
    console.log('\n8. Proveedor que no responde (tarda ~6 s)');
    demoraMs = 30_000;
    const t0 = Date.now();
    const colgado = await els.ubicar('3224445555');
    const tardo = Date.now() - t0;
    demoraMs = 0;
    afirmar(colgado === null, 'espera agotada → sin ubicación, sin excepción');
    afirmar(tardo < 10_000, `se rinde en ${(tardo / 1000).toFixed(1)} s, no espera indefinidamente`);
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }

  console.log(fallos.length ? `\n✗ ${fallos.length} fallo(s):` : '\n✓ Todo bien');
  fallos.forEach((f) => console.log(`   - ${f}`));
  return fallos.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
