import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deduplicación de webhooks de WhatsApp: guarda el id del mensaje (wamid) y lo
 * hace único por tenant, para que los reintentos de Meta no dupliquen mensajes.
 */
export class MensajeWaId1786600000000 implements MigrationInterface {
  name = 'MensajeWaId1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "casos_mensajes" ADD COLUMN IF NOT EXISTS "waMessageId" character varying(120)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_casos_mensajes_tenant_wamid" ` +
        `ON "casos_mensajes" ("tenant", "waMessageId") WHERE "waMessageId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_casos_mensajes_tenant_wamid"`);
    await queryRunner.query(`ALTER TABLE "casos_mensajes" DROP COLUMN IF EXISTS "waMessageId"`);
  }
}
