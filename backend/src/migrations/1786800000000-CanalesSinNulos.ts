import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill: `canales` dejó NULL en las filas creadas ANTES de que la columna
 * existiera (entidades externas, usuarios y casos anteriores a la migración de
 * enrutamiento). Ese NULL llegaba tal cual al navegador y reventaba la
 * detección de cambios de Angular al pintar la lista ("Cannot read properties
 * of null (reading 'length')"), dejando muerta toda la página de
 * Administración. Se normaliza a lista vacía, que es lo que significaba.
 * (Columnas simple-array de TypeORM: la lista vacía se guarda como ''.)
 */
export class CanalesSinNulos1786800000000 implements MigrationInterface {
  name = 'CanalesSinNulos1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "entidades" SET "canales" = '' WHERE "canales" IS NULL`);
    await queryRunner.query(`UPDATE "usuarios" SET "canales" = '' WHERE "canales" IS NULL`);
    await queryRunner.query(`UPDATE "casos" SET "canales" = '' WHERE "canales" IS NULL`);
  }

  public async down(): Promise<void> {
    // Sin reversa: '' y NULL significan lo mismo (sin canales); volver a NULL
    // solo reintroduciría el error.
  }
}
