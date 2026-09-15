import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Desacopla el estado de despacho por entidad: `casos_canales`.
 *
 * Hasta aquí, un caso enviado a policía y a bomberos tenía un solo `estado`.
 * Que policía lo tomara lo ponía «en gestión» también para bomberos, y que
 * policía lo cerrara lo borraba de la bandeja de bomberos en mitad de su
 * trabajo. Esta tabla le da a cada canal destino su propia fila, con su propio
 * estado y su propio reloj.
 *
 * Tres cosas que esta migración hace y conviene no perder de vista:
 *
 * 1. RLS. La tabla lleva datos por inquilino, así que entra al mismo régimen
 *    que las otras seis protegidas: política `tenant_isolation`, ENABLE y
 *    FORCE. Sin FORCE, el rol dueño de la tabla —que es con el que se conecta
 *    la aplicación— quedaría exento de su propia política (ver la migración
 *    ForzarRLS, que corrigió exactamente ese descuido).
 *
 * 2. Índices. El tablero de despacho pregunta siempre «los casos de ESTE canal
 *    en ESTE estado», y lo pregunta una vez por minuto por cada despachador
 *    conectado. Sin el índice compuesto sería un recorrido secuencial cada vez.
 *
 * 3. Relleno. Los casos que ya existen tienen sus canales en el arreglo
 *    `casos.canales`; se convierten en filas, heredando el estado actual del
 *    caso para no alterar lo que hoy ve cada bandeja. La agencia de cada fila
 *    se resuelve contra `canales.agenciaId`; si un canal quedó huérfano en el
 *    catálogo, esa fila se omite en vez de inventarle una agencia.
 */
export class CasosCanales1794000000000 implements MigrationInterface {
  name = 'CasosCanales1794000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS casos_canales (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant        varchar(64)  NOT NULL,
        "casoId"      uuid         NOT NULL,
        "canalId"     uuid         NOT NULL,
        "agenciaId"   uuid         NOT NULL,
        estado        varchar(20)  NOT NULL DEFAULT 'nuevo',
        "codigoCierre" varchar(32),
        "creadoEn"    timestamptz  NOT NULL DEFAULT now(),
        "actualizadoEn" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_casos_canales_bandeja"
        ON casos_canales (tenant, "canalId", estado)
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_casos_canales_caso"
        ON casos_canales (tenant, "casoId")
    `);
    // Un caso no puede estar dos veces en el mismo canal: remitirlo de nuevo al
    // mismo sitio actualiza la fila, no crea una segunda.
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_casos_canales_caso_canal"
        ON casos_canales (tenant, "casoId", "canalId")
    `);

    // --- Relleno de lo existente -------------------------------------------
    // Se hace ANTES de activar RLS: con la política puesta, este INSERT
    // correría sin `app.tenant` fijado y no insertaría ni una fila —
    // silenciosamente, que es la peor forma de fallar.
    await runner.query(`
      INSERT INTO casos_canales (tenant, "casoId", "canalId", "agenciaId", estado, "codigoCierre", "creadoEn")
      SELECT c.tenant,
             c.id,
             canal_id::uuid,
             ca."agenciaId",
             c.estado,
             c."codigoCierre",
             c."creadoEn"
        FROM casos c
        CROSS JOIN LATERAL unnest(c.canales) AS canal_id
        JOIN canales ca ON ca.id = canal_id::uuid
       WHERE c.canales IS NOT NULL
         AND array_length(c.canales, 1) > 0
      ON CONFLICT DO NOTHING
    `);

    await runner.query(`ALTER TABLE casos_canales ENABLE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE casos_canales FORCE ROW LEVEL SECURITY`);
    await runner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON casos_canales;
      CREATE POLICY tenant_isolation ON casos_canales
        USING (tenant = current_setting('app.tenant', true))
        WITH CHECK (tenant = current_setting('app.tenant', true));
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS casos_canales`);
  }
}
