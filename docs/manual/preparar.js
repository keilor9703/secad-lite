// Prepara la base de demostración: función set_tenant, RLS en toda tabla con
// columna tenant, y la siembra DIVIPOLA ejecutando la migración de verdad.
const { Client } = require('/home/user/secad-lite/backend/node_modules/pg');

const URL = 'postgres://falcon:falcon@127.0.0.1:5432/falcon';

async function main() {
  const c = new Client({ connectionString: URL });
  await c.connect();

  await c.query(`
    CREATE OR REPLACE FUNCTION set_tenant(t text)
    RETURNS void LANGUAGE plpgsql AS $$
    BEGIN PERFORM set_config('app.tenant', t, true); END; $$;`);

  // Exactamente las tablas que las migraciones protegen (HabilitarRLS +
  // ForzarRLS + CasosCanales + CasosChatInterno + Archivos + Videollamada).
  // Las demás —roles, usuarios, catálogos, config— nunca llevaron RLS: el
  // backend las siembra al arrancar, sin tenant en contexto.
  const PROTEGIDAS = [
    'casos', 'casos_eventos', 'asignaciones', 'recursos', 'llamadas',
    'casos_mensajes', 'casos_canales', 'casos_chat_interno',
    'archivos', 'archivos_chunks', 'video_sesiones', 'video_chat_mensajes',
  ];
  const { rows: todas } = await c.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'`);
  for (const { table_name: t } of todas) {
    if (PROTEGIDAS.includes(t)) continue;
    await c.query(`ALTER TABLE "${t}" NO FORCE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE "${t}" DISABLE ROW LEVEL SECURITY`);
  }
  const rows = PROTEGIDAS.map(t => ({ table_name: t }));

  console.log(`RLS en ${rows.length} tablas: ${rows.map(r => r.table_name).join(', ')}`);

  // La migración real, con un runner mínimo.
  const { SembrarDivipola1793000000000 } =
    require('/home/user/secad-lite/backend/dist/migrations/1793000000000-SembrarDivipola.js');
  await new SembrarDivipola1793000000000().up({ query: (q, p) => c.query(q, p) });

  const geo = await c.query(
    `SELECT (SELECT count(*) FROM geo_departamentos) d, (SELECT count(*) FROM geo_municipios) m`);
  console.log(`DIVIPOLA: ${geo.rows[0].d} departamentos, ${geo.rows[0].m} municipios`);

  // La tabla la crea TypeORM al migrar; aquí corremos con DB_MIGRATE=false,
  // así que puede no existir todavía.
  await c.query(`CREATE TABLE IF NOT EXISTS migrations (
    id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)`);

  // Las migraciones quedan marcadas: el esquema ya está al día por synchronize.
  const fs = require('fs');
  const archivos = fs.readdirSync('/home/user/secad-lite/backend/dist/migrations')
    .filter(f => f.endsWith('.js'));
  for (const f of archivos) {
    const m = require('/home/user/secad-lite/backend/dist/migrations/' + f);
    const Clase = Object.values(m).find(v => typeof v === 'function');
    if (!Clase) continue;
    const nombre = Clase.name;
    const ts = Number(f.split('-')[0]);
    await c.query(
      `INSERT INTO migrations ("timestamp", name) SELECT $1::bigint, $2::varchar
       WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = $2::varchar)`,
      [ts, nombre]);
  }
  const { rows: mig } = await c.query('SELECT count(*) n FROM migrations');
  console.log(`Migraciones marcadas: ${mig[0].n}`);

  await c.end();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
