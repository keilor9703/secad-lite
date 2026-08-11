import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reporte de llamadas (conteos por estado + tiempo promedio de respuesta):
 * hace falta el instante en que se atendió, aparte de `actualizadoEn` (que se
 * vuelve a pisar cuando la llamada pasa a 'finalizada' al colgar).
 */
export class LlamadaAtendidaEn1787100000000 implements MigrationInterface {
  name = 'LlamadaAtendidaEn1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "llamadas" ADD COLUMN IF NOT EXISTS "atendidaEn" timestamptz`);
    // Backfill best-effort de lo ya atendido: no hay forma de saber el instante
    // exacto retroactivamente, así que se aproxima con "actualizadoEn" SOLO
    // para las que quedaron en 'atendida' (aún no colgaron, esa columna no se
    // volvió a pisar). Las 'finalizada' antiguas quedan sin dato: mejor sin
    // valor que uno claramente equivocado.
    await queryRunner.query(
      `UPDATE "llamadas" SET "atendidaEn" = "actualizadoEn" WHERE "estado" = 'atendida' AND "atendidaEn" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "llamadas" DROP COLUMN IF EXISTS "atendidaEn"`);
  }
}
