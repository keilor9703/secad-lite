/**
 * Prueba de integración del ARCHIVADO de grabaciones, contra PostgreSQL DE
 * VERDAD y un almacenamiento de objetos simulado.
 *
 * Por qué así: lo que puede fallar aquí no está en la lógica de TypeScript. Está
 * en que una tabla con FORCE ROW LEVEL SECURITY devuelve CERO filas en vez de
 * fallar cuando falta `app.tenant` —un barrido escrito con el repositorio
 * inyectado parecería funcionar y no archivaría nunca nada—, y en que los bytes
 * solo se pueden liberar DESPUÉS de comprobar que lo subido coincide. Un mock
 * diría que sí a las dos cosas.
 *
 * El almacenamiento sí se simula, y a propósito: hace falta poder ordenarle que
 * corrompa lo subido, que rechace la subida, y que devuelva menos bytes de los
 * que recibió. Eso es justo lo que no se puede ensayar contra Oracle.
 *
 * IMPORTANTE: hay que conectarse con un rol NORMAL, no con el superusuario. Un
 * superusuario se salta RLS aunque la tabla tenga FORCE, así que la prueba de
 * aislamiento pasaría sin comprobar nada.
 *
 *   DATABASE_URL=postgres://falcon_app:falcon@127.0.0.1:5432/falcon \
 *     npx ts-node -r tsconfig-paths/register test/archivado.integracion.ts
 */
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { ArchivoEntity } from '../src/archivos/archivo.entity';
import { ArchivoChunkEntity } from '../src/archivos/archivo-chunk.entity';
import { TenantEntity } from '../src/tenants/tenant.entity';
import { ArchivosService } from '../src/archivos/archivos.service';
import { ArchivadoService } from '../src/archivos/archivado.service';
import { AlmacenObjetosService } from '../src/archivos/almacen-objetos.service';
import { TenantRlsService } from '../src/common/tenant-rls.service';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

// ── Almacenamiento de objetos simulado ──────────────────────────────────────
type Modo = 'normal' | 'corrompe' | 'rechaza';

interface Almacen {
  server: Server;
  base: string;
  objetos: Map<string, Buffer>;
  modo: Modo;
}

async function levantarAlmacen(): Promise<Almacen> {
  const estado = { objetos: new Map<string, Buffer>(), modo: 'normal' as Modo };

  const server = createServer((req, res) => {
    // La clave es el nombre del objeto, sin el prefijo del PAR: así la prueba
    // comprueba contra el mismo nombre que guardó en `objetoRemoto`.
    const clave = decodeURIComponent((req.url ?? '').replace(/^.*?\/o\//, ''));
    if (req.method === 'PUT') {
      const partes: Buffer[] = [];
      req.on('data', (d: Buffer) => partes.push(d));
      req.on('end', () => {
        if (estado.modo === 'rechaza') { res.statusCode = 500; res.end('no'); return; }
        estado.objetos.set(clave, Buffer.concat(partes));
        res.statusCode = 200; res.end('ok');
      });
      return;
    }
    if (req.method === 'GET') {
      const guardado = estado.objetos.get(clave);
      if (!guardado) { res.statusCode = 404; res.end('no está'); return; }
      // `corrompe` devuelve lo subido menos el último byte: es el fallo que de
      // verdad ocurre —un objeto truncado que el PUT reportó como 200—, y el
      // único que distingue archivar de perder.
      const cuerpo = estado.modo === 'corrompe' ? guardado.subarray(0, guardado.length - 1) : guardado;
      res.statusCode = 200; res.end(cuerpo);
      return;
    }
    res.statusCode = 405; res.end();
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const puerto = (server.address() as AddressInfo).port;
  return {
    server,
    base: `http://127.0.0.1:${puerto}/p/token/n/tenancy/b/falcon-archivo/o`,
    get objetos() { return estado.objetos; },
    get modo() { return estado.modo; },
    set modo(m: Modo) { estado.modo = m; },
  } as Almacen;
}

function configFalsa(valores: Record<string, string>): ConfigService {
  return { get: (clave: string, pordefecto?: string) => valores[clave] ?? pordefecto } as unknown as ConfigService;
}

async function main(): Promise<number> {
  const almacen = await levantarAlmacen();

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://falcon_app:falcon@127.0.0.1:5432/falcon',
    entities: [ArchivoEntity, ArchivoChunkEntity, TenantEntity],
    synchronize: true,
    logging: false,
  });
  await ds.initialize();

  await ds.query(`
    CREATE OR REPLACE FUNCTION set_tenant(t text)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN PERFORM set_config('app.tenant', t, true); END; $$;
  `);
  for (const tabla of ['archivos', 'archivos_chunks']) {
    await ds.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
    await ds.query(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`);
    await ds.query(`DROP POLICY IF EXISTS tenant_isolation ON ${tabla}`);
    await ds.query(`
      CREATE POLICY tenant_isolation ON ${tabla}
        USING (tenant = current_setting('app.tenant', true))
        WITH CHECK (tenant = current_setting('app.tenant', true));
    `);
  }

  const esSuper: Array<{ s: boolean }> = await ds.query(
    `SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`);
  if (esSuper[0]?.s) {
    console.error('\n✗ Esta prueba está conectada como SUPERUSUARIO: RLS no se aplica y no probaría nada.');
    return 1;
  }

  const rls = new TenantRlsService(ds);
  const archivos = new ArchivosService(
    ds.getRepository(ArchivoEntity), ds.getRepository(TenantEntity), rls);
  const objetos = new AlmacenObjetosService(configFalsa({ ARCHIVO_OBJETOS_URL: almacen.base }));
  const archivado = new ArchivadoService(
    ds.getRepository(TenantEntity), ds, rls, archivos, objetos,
    configFalsa({ ARCHIVO_DIAS: '90' }));

  for (const codigo of ['tunja', 'mebog']) {
    await ds.query(
      `INSERT INTO tenants (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING`,
      [codigo, codigo.toUpperCase()]);
    await rls.conTenant(codigo, (m) => m.query(`DELETE FROM archivos WHERE tenant = $1`, [codigo]));
  }

  const casoId = '22222222-2222-2222-2222-222222222222';

  /** Siembra una grabación cerrada, con contenido y con la antigüedad pedida. */
  async function sembrar(
    tenant: string, nombre: string, dias: number, contenido: string,
    origen: 'GRABACION' | 'ADJUNTO' = 'GRABACION',
  ): Promise<{ id: string; sha: string; bytes: number }> {
    const a = await archivos.crear(tenant, {
      casoId, nombre, tipoMime: origen === 'GRABACION' ? 'video/webm' : 'application/pdf',
      usuario: 'operador1', origen,
    });
    // En trozos, como llega de verdad una grabación.
    const partes = contenido.match(/.{1,7}/g) ?? [contenido];
    for (let i = 0; i < partes.length; i++) {
      await archivos.anexarChunk(tenant, a.id, i, Buffer.from(partes[i]));
    }
    await archivos.finalizar(tenant, a.id);
    await rls.conTenant(tenant, (m) => m.query(
      `UPDATE archivos SET "creadoEn" = now() - ($2 || ' days')::interval WHERE id = $1`, [a.id, dias]));
    return {
      id: a.id,
      sha: createHash('sha256').update(Buffer.from(contenido)).digest('hex'),
      bytes: Buffer.byteLength(contenido),
    };
  }

  const chunksDe = async (tenant: string, id: string): Promise<number> => {
    const r: Array<{ n: string }> = await rls.conTenant(tenant, (m) => m.query(
      `SELECT count(*)::text AS n FROM archivos_chunks WHERE "archivoId" = $1`, [id]));
    return Number(r[0].n);
  };
  const filaDe = (tenant: string, id: string) => archivos.obtener(tenant, id);
  const leerTodo = async (tenant: string, id: string): Promise<string> => {
    const partes: Buffer[] = [];
    for await (const p of archivos.leerContenido(tenant, id)) partes.push(p);
    return Buffer.concat(partes).toString();
  };

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n1) Se archiva lo viejo y NO se toca lo reciente');
  const vieja = await sembrar('tunja', 'vieja.webm', 120, 'GRABACION-VIEJA-DE-TUNJA-0123456789');
  const reciente = await sembrar('tunja', 'reciente.webm', 5, 'GRABACION-DE-ESTA-SEMANA');
  const adjunto = await sembrar('tunja', 'acta.pdf', 300, 'UN-ADJUNTO-ANTIGUO', 'ADJUNTO');
  const ajena = await sembrar('mebog', 'otra.webm', 200, 'GRABACION-VIEJA-DE-MEBOG');

  const archivadas = await archivado.archivarVencidos();
  afirmar(archivadas === 2, `archivó 2 grabaciones, una por instancia (archivó ${archivadas})`);

  const fVieja = await filaDe('tunja', vieja.id);
  afirmar(fVieja?.estado === 'ARCHIVADO', `la vieja quedó ARCHIVADO (quedó ${fVieja?.estado})`);
  afirmar(!!fVieja?.archivadoEn, 'con fecha de archivado');
  afirmar(fVieja?.objetoRemoto === `grabaciones/tunja/${new Date(fVieja!.creadoEn).getUTCFullYear()}/${String(new Date(fVieja!.creadoEn).getUTCMonth() + 1).padStart(2, '0')}/${vieja.id}.webm`,
    `y con la ruta del objeto (${fVieja?.objetoRemoto})`);
  afirmar(fVieja?.sha256 === vieja.sha, 'y con el sha256 del contenido ORIGINAL');
  afirmar(Number(fVieja?.bytes) === vieja.bytes, 'el tamaño registrado no cambia al archivar');
  afirmar(await chunksDe('tunja', vieja.id) === 0, 'sus bytes salieron de la base');

  afirmar((await filaDe('tunja', reciente.id))?.estado === 'COMPLETO',
    'la grabación de esta semana sigue COMPLETO');
  afirmar(await chunksDe('tunja', reciente.id) > 0, 'y con sus bytes en la base');
  afirmar((await filaDe('tunja', adjunto.id))?.estado === 'COMPLETO',
    'un ADJUNTO de 300 días NO se archiva: solo el video crece sin techo');
  afirmar(await chunksDe('tunja', adjunto.id) > 0, 'y conserva sus bytes');

  console.log('\n2) Lo subido es byte a byte el original');
  const guardado = almacen.objetos.get(fVieja!.objetoRemoto!);
  afirmar(!!guardado, 'el objeto está en el almacenamiento');
  afirmar(guardado?.toString() === 'GRABACION-VIEJA-DE-TUNJA-0123456789',
    'y su contenido es el mismo que se grabó');

  console.log('\n3) Una grabación archivada se sigue leyendo igual');
  const flujo = await archivado.abrir(fVieja!);
  const partes: Buffer[] = [];
  for await (const t of flujo as AsyncIterable<Buffer>) partes.push(t);
  afirmar(Buffer.concat(partes).toString() === 'GRABACION-VIEJA-DE-TUNJA-0123456789',
    'vuelve del almacenamiento idéntica — quien la abre no nota la diferencia');

  console.log('\n4) Volver a correr no archiva de nuevo ni duplica');
  afirmar(await archivado.archivarVencidos() === 0, 'la segunda pasada no archiva nada');
  afirmar(await chunksDe('tunja', vieja.id) === 0, 'y no resucita trozos');

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n5) SI LO SUBIDO NO COINCIDE, NO SE BORRA NADA');
  // Es la razón de ser de todo el diseño: subir y borrar confiando en el 200 del
  // PUT es exactamente cómo se pierde evidencia.
  const conCorrupcion = await sembrar('tunja', 'corrupta.webm', 150, 'ESTA-NO-DEBE-PERDERSE-NUNCA');
  almacen.modo = 'corrompe';
  const trasCorrupcion = await archivado.archivarVencidos();
  almacen.modo = 'normal';

  afirmar(trasCorrupcion === 0, `no cuenta como archivada (contó ${trasCorrupcion})`);
  const fCorrupta = await filaDe('tunja', conCorrupcion.id);
  afirmar(fCorrupta?.estado === 'COMPLETO', `sigue COMPLETO en la base (está ${fCorrupta?.estado})`);
  afirmar(!fCorrupta?.archivadoEn, 'sin marca de archivado');
  afirmar(await chunksDe('tunja', conCorrupcion.id) > 0, 'CON SUS BYTES INTACTOS en la base');
  afirmar(await leerTodo('tunja', conCorrupcion.id) === 'ESTA-NO-DEBE-PERDERSE-NUNCA',
    'y se lee completa, como si nada hubiera pasado');

  console.log('\n6) Y al día siguiente, con el almacenamiento sano, se archiva');
  afirmar(await archivado.archivarVencidos() === 1, 'el reintento sí la archiva');
  afirmar((await filaDe('tunja', conCorrupcion.id))?.estado === 'ARCHIVADO', 'ahora sí quedó ARCHIVADO');
  afirmar((await filaDe('tunja', conCorrupcion.id))?.sha256 === conCorrupcion.sha, 'con su sha256 correcto');

  console.log('\n7) Si el almacenamiento rechaza la subida, tampoco se borra nada');
  const conRechazo = await sembrar('tunja', 'rechazada.webm', 150, 'TAMPOCO-ESTA');
  almacen.modo = 'rechaza';
  const trasRechazo = await archivado.archivarVencidos();
  almacen.modo = 'normal';
  afirmar(trasRechazo === 0, 'no archiva');
  afirmar(await chunksDe('tunja', conRechazo.id) > 0, 'y los bytes siguen en la base');
  afirmar((await filaDe('tunja', conRechazo.id))?.estado === 'COMPLETO', 'con el archivo aún COMPLETO');

  console.log('\n8) Un archivo ARCHIVADO está cerrado de verdad');
  let rechazoChunk = false;
  try { await archivos.anexarChunk('tunja', vieja.id, 99, Buffer.from('X')); }
  catch { rechazoChunk = true; }
  afirmar(rechazoChunk, 'no acepta un trozo nuevo: lo dejaría con un byte suelto y nada más');
  afirmar(await chunksDe('tunja', vieja.id) === 0, 'y no quedó ningún trozo insertado');
  const trasFinalizar = await archivos.finalizar('tunja', vieja.id);
  afirmar(trasFinalizar.estado === 'ARCHIVADO', 'y finalizar no lo devuelve a COMPLETO');

  console.log('\n9) El archivado respeta el aislamiento entre instancias');
  const fAjena = await filaDe('mebog', ajena.id);
  afirmar(fAjena?.estado === 'ARCHIVADO', 'la grabación vieja de Mebog también se archivó');
  afirmar(fAjena?.objetoRemoto?.startsWith('grabaciones/mebog/') === true,
    `y en la ruta de SU instancia (${fAjena?.objetoRemoto})`);
  afirmar(await filaDe('mebog', vieja.id) === null,
    'Mebog no ve el archivo de Tunja ni conociendo su id');
  const crudo: Array<{ n: string }> = await rls.conTenant('mebog', (m) => m.query(
    `SELECT count(*)::text AS n FROM archivos WHERE id = $1`, [vieja.id]));
  afirmar(crudo[0].n === '0', 'y una consulta CRUDA desde Mebog tampoco — es RLS, no el servicio');

  console.log('\n10) Dos réplicas no archivan a la vez');
  // Las tres réplicas corren el mismo @Cron. Se simula la otra tomando el lock
  // en su propia conexión, igual que haría ella.
  const otra = ds.createQueryRunner();
  await otra.connect();
  await otra.query('SELECT pg_advisory_lock(1810000000)');
  const pendiente = await sembrar('tunja', 'mientras-otra-trabaja.webm', 150, 'NO-AHORA');
  const conLockTomado = await archivado.archivarVencidos();
  await otra.query('SELECT pg_advisory_unlock(1810000000)');
  await otra.release();

  afirmar(conLockTomado === 0, 'con el lock tomado por otra réplica, esta no archiva nada');
  afirmar(await chunksDe('tunja', pendiente.id) > 0, 'y no toca los bytes de nadie');
  await archivado.archivarVencidos();
  afirmar((await filaDe('tunja', pendiente.id))?.estado === 'ARCHIVADO',
    'liberado el lock, la siguiente pasada sí la archiva');
  afirmar(await chunksDe('tunja', pendiente.id) === 0, 'y le libera los bytes');

  console.log('\n11) Sin almacenamiento configurado, no se archiva (y los bytes quedan)');
  const sinAlmacen = new ArchivadoService(
    ds.getRepository(TenantEntity), ds, rls, archivos,
    new AlmacenObjetosService(configFalsa({})),
    configFalsa({ ARCHIVO_DIAS: '90' }));
  const quedo = await sembrar('tunja', 'sin-destino.webm', 150, 'SIGUE-EN-LA-BASE');
  afirmar(await sinAlmacen.archivarVencidos() === 0, 'no archiva nada');
  afirmar(await chunksDe('tunja', quedo.id) > 0, 'y la grabación sigue entera en la base');

  await ds.destroy();
  almacen.server.close();

  console.log('\n────────────────────────────────────────');
  if (fallos.length) {
    console.log(`${fallos.length} comprobación(es) FALLARON:`);
    for (const f of fallos) console.log(`  ✗ ${f}`);
    return 1;
  }
  console.log('Todas las comprobaciones pasaron.');
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
