import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega el origen del contacto (teléfono, chat de WhatsApp, llamada de
 * WhatsApp) — la PBX del cliente gestiona los tres y notifica a FALCON por
 * el mismo webhook; este campo es lo que distingue uno de otro y fija
 * automáticamente el "Medio de comunicación" del caso al atender.
 */
export class LlamadasOrigen1800000000000 implements MigrationInterface {
  name = 'LlamadasOrigen1800000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        ADD COLUMN IF NOT EXISTS "origen" varchar(20) NOT NULL DEFAULT 'telefono'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE llamadas
        DROP COLUMN IF EXISTS "origen"
    `);
  }
}
