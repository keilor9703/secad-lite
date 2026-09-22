import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat interno entre operadores y despachadores, anclado a un caso —
 * `casos_chat_interno`. Mismo régimen que las demás tablas por tenant:
 * política `tenant_isolation`, ENABLE y FORCE (ver ForzarRLS, que corrigió
 * el descuido de dejar esto sin FORCE en las tablas originales).
 */
export class CasosChatInterno1796000000000 implements MigrationInterface {
  name = 'CasosChatInterno1796000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS casos_chat_interno (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant        varchar(64)  NOT NULL,
        "casoId"      uuid         NOT NULL,
        "autorId"     varchar(120) NOT NULL,
        "autorNombre" varchar(120) NOT NULL,
        texto         text         NOT NULL,
        "creadoEn"    timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_casos_chat_interno_caso"
        ON casos_chat_interno (tenant, "casoId", "creadoEn")
    `);

    await runner.query(`ALTER TABLE casos_chat_interno ENABLE ROW LEVEL SECURITY`);
    await runner.query(`ALTER TABLE casos_chat_interno FORCE ROW LEVEL SECURITY`);
    await runner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON casos_chat_interno;
      CREATE POLICY tenant_isolation ON casos_chat_interno
        USING (tenant = current_setting('app.tenant', true))
        WITH CHECK (tenant = current_setting('app.tenant', true));
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS casos_chat_interno`);
  }
}
