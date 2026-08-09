import { MigrationInterface, QueryRunner } from 'typeorm';

/** Bitácora de administración: rastro de cambios en usuarios, roles y claves. */
export class AdminBitacora1786700000000 implements MigrationInterface {
  name = 'AdminBitacora1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_bitacora" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "autor" character varying(120) NOT NULL,
        "accion" character varying(60) NOT NULL,
        "detalle" text NOT NULL,
        "creadoEn" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_bitacora" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_bitacora_tenant_fecha" ON "admin_bitacora" ("tenant", "creadoEn")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_bitacora"`);
  }
}
