import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credenciales del proveedor de SMS, una configuración por instancia.
 *
 * Por tenant y no global porque cada municipio contrata con quien quiera y el
 * consumo se le factura a él.
 *
 * NO lleva RLS: la consulta el servicio de envío por `tenant`, y a diferencia
 * de las tablas de operación no contiene datos del ciudadano. La `apiKey` va
 * cifrada en reposo (AES-256-GCM, ver common/secretos.ts).
 */
export class ConfigSms1804000000000 implements MigrationInterface {
  name = 'ConfigSms1804000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS config_sms (
        id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant           varchar(64)  NOT NULL UNIQUE,
        proveedor        varchar(24)  NOT NULL DEFAULT 'INFOBIP',
        "apiKey"         varchar(500),
        "baseUrl"        varchar(200),
        sender           varchar(40),
        activo           boolean      NOT NULL DEFAULT true,
        "actualizadoPor" varchar(120),
        "actualizadoEn"  timestamptz  NOT NULL DEFAULT now()
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS config_sms`);
  }
}
