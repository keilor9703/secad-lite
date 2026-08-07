import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El recurso pasa a referenciar la agencia del catálogo por id, en vez de
 * llevarla solo como texto escrito a mano. El texto se conserva denormalizado
 * (lo muestran los listados y lo traen los recursos anteriores al catálogo).
 *
 * Se intenta emparejar los recursos existentes con la agencia cuyo nombre o
 * código coincida, para no dejar la flota sembrada sin entidad.
 */
export class RecursoAgencia1786290000000 implements MigrationInterface {
  name = 'RecursoAgencia1786290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recursos" ADD "agenciaId" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_recursos_tenant_agencia" ON "recursos" ("tenant", "agenciaId")`);

    // Emparejamiento tolerante: sin distinguir mayúsculas ni espacios de más.
    await queryRunner.query(`
      UPDATE "recursos" r
         SET "agenciaId" = a."id"
        FROM "agencias" a
       WHERE a."tenant" = r."tenant"
         AND r."agenciaId" IS NULL
         AND (
           lower(btrim(a."nombre")) = lower(btrim(r."agencia"))
           OR upper(btrim(a."codigo")) = upper(btrim(r."agencia"))
         )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_recursos_tenant_agencia"`);
    await queryRunner.query(`ALTER TABLE "recursos" DROP COLUMN "agenciaId"`);
  }
}
