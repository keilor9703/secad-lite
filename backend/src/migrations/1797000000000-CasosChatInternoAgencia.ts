import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega la agencia del autor al chat interno — para mostrar "Usuario -
 * Agencia" en vez de solo el nombre, y saber de un vistazo de qué entidad
 * viene cada mensaje en un caso que atienden varias a la vez.
 */
export class CasosChatInternoAgencia1797000000000 implements MigrationInterface {
  name = 'CasosChatInternoAgencia1797000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE casos_chat_interno
        ADD COLUMN IF NOT EXISTS "autorAgencia" varchar(120)
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE casos_chat_interno
        DROP COLUMN IF EXISTS "autorAgencia"
    `);
  }
}
