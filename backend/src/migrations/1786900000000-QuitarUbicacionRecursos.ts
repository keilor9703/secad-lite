import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El sistema deja de guardar ubicación de recursos (patrullas, ambulancias…):
 * nunca hubo un mecanismo real de rastreo detrás (solo coordenadas semilla
 * fijas), así que las columnas eran datos muertos que además dejaban creer
 * que había geolocalización en vivo. La asignación de recursos a un caso
 * sigue igual; lo que se elimina es la "cercanía" estimada por coordenadas.
 */
export class QuitarUbicacionRecursos1786900000000 implements MigrationInterface {
  name = 'QuitarUbicacionRecursos1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recursos" DROP COLUMN IF EXISTS "lat"`);
    await queryRunner.query(`ALTER TABLE "recursos" DROP COLUMN IF EXISTS "lng"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "recursos" ADD COLUMN "lat" double precision`);
    await queryRunner.query(`ALTER TABLE "recursos" ADD COLUMN "lng" double precision`);
  }
}
