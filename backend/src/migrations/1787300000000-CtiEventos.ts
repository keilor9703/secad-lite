import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registro crudo de eventos entrantes de la integración CTI/YACO — ver
 * CtiEventoEntity para el porqué de guardarlos sin interpretar todavía.
 */
export class CtiEventos1787300000000 implements MigrationInterface {
  name = 'CtiEventos1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cti_eventos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "identificadorInteraccion" character varying(120),
        "payload" jsonb NOT NULL,
        "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cti_eventos" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cti_eventos_tenant_creadoEn" ON "cti_eventos" ("tenant", "creadoEn")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cti_eventos"`);
  }
}
