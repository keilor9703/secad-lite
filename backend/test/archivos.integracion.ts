/**
 * Prueba de integración de la capa de archivos, contra PostgreSQL DE VERDAD.
 *
 * Por qué no basta un test con mocks: lo que puede fallar aquí no está en la
 * lógica de TypeScript sino en la base —el aislamiento por RLS, la idempotencia
 * del índice único, y que un bytea vuelva a salir con los mismos bytes que
 * entró—. Un mock diría que sí a todo eso.
 *
 * IMPORTANTE: hay que conectarse con un rol NORMAL, no con el superusuario.
 * Un superusuario se salta RLS aunque la tabla tenga FORCE, así que la prueba
 * de aislamiento pasaría sin comprobar nada.
 *
 *   DATABASE_URL=postgres://falcon_app:falcon@127.0.0.1:5432/falcon \
 *     npx ts-node -r tsconfig-paths/register test/archivos.integracion.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ArchivoEntity } from '../src/archivos/archivo.entity';
import { ArchivoChunkEntity } from '../src/archivos/archivo-chunk.entity';
import { TenantEntity } from '../src/tenants/tenant.entity';
import { ArchivosService } from '../src/archivos/archivos.service';
import { TenantRlsService } from '../src/common/tenant-rls.service';

const fallos: string[] = [];
function afirmar(ok: boolean, que: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${que}`);
  if (!ok) fallos.push(que);
}

async function main(): Promise<number> {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://falcon_app:falcon@127.0.0.1:5432/falcon',
    entities: [ArchivoEntity, ArchivoChunkEntity, TenantEntity],
    synchronize: true,
    logging: false,
  });
  await ds.initialize();

  // set_tenant y las políticas las crean las migraciones del proyecto; aquí se
  // replican para que la prueba corra sola sobre una base limpia.
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

  const rls = new TenantRlsService(ds);
  const svc = new ArchivosService(
    ds.getRepository(ArchivoEntity),
    ds.getRepository(TenantEntity),
    rls,
  );

  // Dos instancias, para poder probar el aislamiento de verdad.
  await rls.conTenant('tunja', (m) => m.query(`DELETE FROM archivos WHERE tenant = 'tunja'`));
  await rls.conTenant('mebog', (m) => m.query(`DELETE FROM archivos WHERE tenant = 'mebog'`));
  for (const codigo of ['tunja', 'mebog']) {
    await ds.query(
      `INSERT INTO tenants (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING`,
      [codigo, codigo.toUpperCase()],
    );
  }

  const casoId = '11111111-1111-1111-1111-111111111111';

  console.log('\n1) Subida por trozos');
  const archivo = await svc.crear('tunja', {
    casoId, nombre: 'grabacion.webm', tipoMime: 'video/webm',
    usuario: 'operador1', origen: 'GRABACION',
  });
  afirmar(archivo.estado === 'EN_CURSO', 'el archivo nace EN_CURSO, antes de tener contenido');

  const trozos = [Buffer.from('AAAA'), Buffer.from('BBBB'), Buffer.from('CCCC')];
  let bytes = 0;
  for (let i = 0; i < trozos.length; i++) bytes = await svc.anexarChunk('tunja', archivo.id, i, trozos[i]);
  afirmar(bytes === 12, `tres trozos de 4 bytes suman 12 (dio ${bytes})`);

  console.log('\n2) Reintentar un trozo NO lo duplica');
  // Es el caso normal, no el raro: una grabación sobre una red mala reintenta.
  const trasReintento = await svc.anexarChunk('tunja', archivo.id, 1, trozos[1]);
  afirmar(trasReintento === 12, `el tamaño no cambia al reenviar el trozo 1 (dio ${trasReintento})`);

  console.log('\n3) El contenido vuelve a salir igual que entró');
  await svc.finalizar('tunja', archivo.id);
  const partes: Buffer[] = [];
  for await (const p of svc.leerContenido('tunja', archivo.id)) partes.push(p);
  const contenido = Buffer.concat(partes).toString();
  afirmar(contenido === 'AAAABBBBCCCC', `se leyó «${contenido}»`);

  console.log('\n4) Cerrar dos veces no rompe nada');
  const otraVez = await svc.finalizar('tunja', archivo.id);
  afirmar(otraVez.estado === 'COMPLETO', 'sigue COMPLETO tras finalizar de nuevo');

  console.log('\n5) Una subida sin un solo trozo queda FALLIDA, no COMPLETA');
  const vacio = await svc.crear('tunja', {
    casoId, nombre: 'nada.webm', tipoMime: 'video/webm', usuario: 'operador1', origen: 'GRABACION',
  });
  const cerrado = await svc.finalizar('tunja', vacio.id);
  afirmar(cerrado.estado === 'FALLIDO', `quedó ${cerrado.estado} — no se ofrece una descarga vacía`);

  console.log('\n6) Aislamiento entre instancias');
  const deTunja = await svc.listarPorCaso('tunja', casoId);
  const deMebog = await svc.listarPorCaso('mebog', casoId);
  afirmar(deTunja.length === 2, `Tunja ve sus 2 archivos (vio ${deTunja.length})`);
  afirmar(deMebog.length === 0, `Mebog NO ve los archivos de Tunja (vio ${deMebog.length})`);

  const ajeno = await svc.obtener('mebog', archivo.id);
  afirmar(ajeno === null, 'ni siquiera conociendo el id exacto del archivo de otra instancia');

  const trozosAjenos: Buffer[] = [];
  for await (const p of svc.leerContenido('mebog', archivo.id)) trozosAjenos.push(p);
  afirmar(trozosAjenos.length === 0, 'y el contenido tampoco se puede leer desde otra instancia');

  // Lo de arriba lo garantiza el propio servicio, que filtra por tenant en cada
  // consulta. Eso NO prueba que RLS esté haciendo su trabajo: pasaría igual con
  // la política apagada. Esto sí lo prueba — una consulta CRUDA, sin filtro de
  // tenant, bajo el contexto de la otra instancia.
  const crudo: Array<{ n: string }> = await rls.conTenant('mebog', (m) =>
    m.query(`SELECT count(*)::text AS n FROM archivos`));
  afirmar(crudo[0].n === '0',
    `una consulta sin filtro de tenant, desde Mebog, ve ${crudo[0].n} filas — es RLS, no el servicio`);

  const crudoPropio: Array<{ n: string }> = await rls.conTenant('tunja', (m) =>
    m.query(`SELECT count(*)::text AS n FROM archivos`));
  afirmar(Number(crudoPropio[0].n) >= 2,
    `y desde Tunja esa misma consulta sí ve sus ${crudoPropio[0].n} filas`);

  // Y que el rol de la prueba no sea superusuario, porque un superusuario se
  // salta RLS y las dos comprobaciones de arriba no valdrían nada.
  const rol: Array<{ super: boolean }> = await ds.query(
    `SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user`);
  afirmar(rol[0]?.super === false,
    'la prueba corre con un rol normal, no superusuario (si no, RLS no aplicaría)');

  console.log('\n7) Tipos no permitidos se rechazan antes de tocar la base');
  let rechazado = false;
  try {
    await svc.crear('tunja', {
      casoId, nombre: 'x.exe', tipoMime: 'application/x-msdownload', usuario: 'operador1',
    });
  } catch { rechazado = true; }
  afirmar(rechazado, 'un ejecutable no se acepta como adjunto');

  console.log('\n8) Subida de una sola vez (el adjunto normal)');
  const completo = await svc.subirCompleto(
    'tunja',
    { casoId, nombre: 'foto.jpg', tipoMime: 'image/jpeg', usuario: 'operador1' },
    Buffer.from('imagen-de-prueba'),
  );
  afirmar(completo.estado === 'COMPLETO' && Number(completo.bytes) === 16,
    `quedó COMPLETO con ${completo.bytes} bytes`);

  console.log('\n9) Barrido de subidas abandonadas');
  const abandonada = await svc.crear('tunja', {
    casoId, nombre: 'muerta.webm', tipoMime: 'video/webm', usuario: 'operador1', origen: 'GRABACION',
  });
  await svc.anexarChunk('tunja', abandonada.id, 0, Buffer.from('X'));
  // Se envejece a mano para no esperar cinco minutos.
  await rls.conTenant('tunja', (m) =>
    m.query(`UPDATE archivos SET "ultimoChunkEn" = NOW() - INTERVAL '10 minutes' WHERE id = $1`, [abandonada.id]));

  const barridas = await svc.barrerAbandonados();
  afirmar(barridas >= 1, `el barrido cerró ${barridas} subida(s) muerta(s)`);
  const tras = await svc.obtener('tunja', abandonada.id);
  afirmar(tras?.estado === 'FALLIDO', `quedó ${tras?.estado}`);
  const sigueElContenido: Buffer[] = [];
  for await (const p of svc.leerContenido('tunja', abandonada.id)) sigueElContenido.push(p);
  afirmar(Buffer.concat(sigueElContenido).toString() === 'X',
    'y lo que alcanzó a subirse NO se borró: puede ser justo lo que importa');

  await ds.destroy();

  console.log(fallos.length === 0
    ? '\n────────── TODO EN VERDE ──────────'
    : `\n────────── ${fallos.length} FALLO(S) ──────────\n  - ${fallos.join('\n  - ')}`);
  return fallos.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
