import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la fecha/hora del evento tal como la reporta la propia central
 * telefónica en el webhook — se guarda sin usarse para nada más; el instante
 * que usa el sistema (orden, reportes) sigue siendo `creadoEn`/`atendidaEn`.
 */
export class LlamadasFechaHoraPbx1799000000000 implements MigrationInterface {
  name = 'LlamadasFechaHoraPbx1799000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        ADD COLUMN IF NOT EXISTS "fechaHoraPbx" timestamptz
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        DROP COLUMN IF EXISTS "fechaHoraPbx"
    `);
  }
}
