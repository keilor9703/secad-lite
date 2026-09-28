import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Amplía `pbx_webhook_rechazado` a un registro de TODAS las peticiones al
 * webhook de PBX, no solo las rechazadas — se necesitaba ver también las
 * que sí se aceptaron, en el mismo lugar. Se renombra en vez de crear una
 * tabla aparte: es la misma información (una fila por petición), solo que
 * ahora también cubre el camino feliz.
 */
export class PbxWebhookLog1802000000000 implements MigrationInterface {
  name = 'PbxWebhookLog1802000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE pbx_webhook_rechazado RENAME TO pbx_webhook_log`);
    await runner.query(`
      ALTER TABLE pbx_webhook_log
        ADD COLUMN IF NOT EXISTS exitoso boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS evento varchar(20),
        ADD COLUMN IF NOT EXISTS "llamadaId" uuid,
        ALTER COLUMN motivo DROP NOT NULL
    `);
    // El DEFAULT solo era para rellenar las filas ya existentes (todas
    // rechazos, antes de que existiera esta columna); de acá en adelante
    // cada inserción lo indica explícitamente.
    await runner.query(`ALTER TABLE pbx_webhook_log ALTER COLUMN exitoso DROP DEFAULT`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM pbx_webhook_log WHERE exitoso = true`);
    await runner.query(`
      ALTER TABLE pbx_webhook_log
        DROP COLUMN IF EXISTS exitoso,
        DROP COLUMN IF EXISTS evento,
        DROP COLUMN IF EXISTS "llamadaId",
        ALTER COLUMN motivo SET NOT NULL
    `);
    await runner.query(`ALTER TABLE pbx_webhook_log RENAME TO pbx_webhook_rechazado`);
  }
}
