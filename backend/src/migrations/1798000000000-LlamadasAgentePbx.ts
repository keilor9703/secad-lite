import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el agente que reporta la propia central telefónica en el webhook —
 * distinto de `atendidaPor` (quien atendió desde la app FALCON).
 */
export class LlamadasAgentePbx1798000000000 implements MigrationInterface {
  name = 'LlamadasAgentePbx1798000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        ADD COLUMN IF NOT EXISTS "agentePbx" varchar(120)
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        DROP COLUMN IF EXISTS "agentePbx"
    `);
  }
}
