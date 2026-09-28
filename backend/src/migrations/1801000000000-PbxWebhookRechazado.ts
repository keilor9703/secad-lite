import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro de los intentos al webhook de PBX que se rechazaron (API key
 * inválida, tenant no vigente, body mal formado, colgada sin ubicar). Sin
 * RLS a propósito, igual que `admin_bitacora`: un intento con API key
 * inválida no tiene tenant que aislar, y el registro lo escribe un filtro de
 * excepciones, no una operación dentro de una transacción por tenant.
 */
export class PbxWebhookRechazado1801000000000 implements MigrationInterface {
  name = 'PbxWebhookRechazado1801000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS pbx_webhook_rechazado (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant       varchar(64),
        "estadoHttp" int          NOT NULL,
        motivo       text         NOT NULL,
        ip           varchar(64),
        cuerpo       text,
        "creadoEn"   timestamptz  NOT NULL DEFAULT now()
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_pbx_webhook_rechazado_fecha"
        ON pbx_webhook_rechazado ("creadoEn")
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS pbx_webhook_rechazado`);
  }
}
