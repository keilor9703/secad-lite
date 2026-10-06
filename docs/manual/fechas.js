// Reparte los casos sobre los últimos días y separa sus eventos con tiempos
// plausibles. Sin esto, el Panel mide una jornada entera ocurrida en un minuto:
// todos los casos y sus eventos nacen con el mismo segundo del sembrado.
//
// No inventa eventos ni cambia estados: solo mueve relojes, conservando el
// orden original de cada caso.
const { Client } = require('/home/user/secad-lite/backend/node_modules/pg');
const URL = 'postgres://falcon:falcon@127.0.0.1:5432/falcon';

// Minutos desde la recepción hasta cada hito. Rangos tomados de lo que una
// central considera razonable, no de un promedio real de ningún municipio.
const DEMORA = { creacion: [0, 0], estado: [0.6, 2.8], despacho: [1.4, 5.2] };
const DEMORA_CIERRE = [25, 95];

const entre = ([a, b]) => a + Math.random() * (b - a);

async function main() {
  const c = new Client({ connectionString: URL });
  await c.connect();
  await c.query(`SELECT set_config('app.tenant', 'demo', false)`);

  const { rows: casos } = await c.query(
    `SELECT id, estado, "creadoEn" FROM casos WHERE tenant='demo' ORDER BY "creadoEn"`);

  const ahora = Date.now();
  let movidos = 0;

  for (let i = 0; i < casos.length; i++) {
    const caso = casos[i];
    // Los cerrados son historial (hasta 7 días atrás); los abiertos, de hoy.
    const abierto = caso.estado !== 'cerrado';
    const diasAtras = abierto ? Math.random() * 0.4 : 0.5 + Math.random() * 28.5;
    // Entre las 06:00 y las 23:00: una central recibe de día y de noche, pero
    // una captura con todo a las 3 a.m. no representa la operación.
    const inicio = new Date(ahora - diasAtras * 86400_000);
    const hora = 6 + Math.random() * 17;
    inicio.setHours(Math.floor(hora), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
    if (inicio.getTime() > ahora) inicio.setTime(ahora - 15 * 60_000);

    await c.query(`UPDATE casos SET "creadoEn"=$2, "actualizadoEn"=$2 WHERE id=$1`, [caso.id, inicio]);

    const { rows: eventos } = await c.query(
      `SELECT id, tipo FROM casos_eventos WHERE "casoId"=$1 ORDER BY "creadoEn"`, [caso.id]);

    let ultimo = 0;
    for (let j = 0; j < eventos.length; j++) {
      const ev = eventos[j];
      // El último «estado» de un caso cerrado es el cierre, que tarda más.
      const esCierre = caso.estado === 'cerrado' && j === eventos.length - 1;
      const minutos = esCierre ? entre(DEMORA_CIERRE) : entre(DEMORA[ev.tipo] ?? [2, 8]);
      ultimo = Math.max(ultimo + 0.5, minutos);   // nunca hacia atrás
      await c.query(`UPDATE casos_eventos SET "creadoEn"=$2 WHERE id=$1`,
        [ev.id, new Date(inicio.getTime() + ultimo * 60_000)]);
    }
    const fin = new Date(inicio.getTime() + ultimo * 60_000);
    await c.query(`UPDATE casos SET "actualizadoEn"=$2 WHERE id=$1`, [caso.id, fin]);
    movidos++;
  }

  // Las asignaciones acompañan a su caso.
  await c.query(`
    UPDATE asignaciones a SET "creadoEn" = c."creadoEn" + interval '6 minutes'
      FROM casos c WHERE c.id = a."casoId" AND a.tenant='demo'`);

  const { rows: ver } = await c.query(`
    SELECT min("creadoEn")::date desde, max("creadoEn")::date hasta, count(*) n
      FROM casos WHERE tenant='demo'`);
  console.log(`✔ ${movidos} casos repartidos entre ${ver[0].desde.toISOString().slice(0,10)} y ${ver[0].hasta.toISOString().slice(0,10)}`);

  const { rows: dur } = await c.query(`
    SELECT round(avg(EXTRACT(EPOCH FROM (e.momento - c."creadoEn"))/60)::numeric, 1) AS min_primer_evento
      FROM casos c JOIN (SELECT "casoId", MIN("creadoEn") momento FROM casos_eventos
                          WHERE tipo='estado' GROUP BY "casoId") e ON e."casoId"=c.id
     WHERE c.tenant='demo'`);
  console.log(`✔ demora media hasta el primer cambio de estado: ${dur[0].min_primer_evento} min`);
  await c.end();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
