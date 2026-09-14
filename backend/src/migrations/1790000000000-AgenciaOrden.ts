import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Orden de despliegue de las agencias en Recepción — antes salían siempre
 * alfabéticas, sin forma de que el tenant las acomodara a su gusto.
 * Se inicializan por el orden alfabético que ya tenían (nombre ASC), para
 * no reordenar de golpe lo que un secad ya venía viendo.
 */
export class AgenciaOrden1790000000000 implements MigrationInterface {
  name = 'AgenciaOrden1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agencias" ADD COLUMN IF NOT EXISTS "orden" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`
      WITH numeradas AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant ORDER BY nombre ASC) - 1 AS n
        FROM agencias
      )
      UPDATE agencias SET orden = numeradas.n
      FROM numeradas WHERE agencias.id = numeradas.id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "agencias" DROP COLUMN IF EXISTS "orden"`);
  }
}
