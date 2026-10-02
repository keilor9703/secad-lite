import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credenciales del proveedor de geolocalización automática (Android ELS).
 *
 * Una sola fila para toda la plataforma —igual que config_sms—: el contrato y
 * la factura son del operador del SaaS. Qué municipios pueden consultarla se
 * decide con la integración `els` de cada tenant, no aquí.
 *
 * NO lleva RLS: no contiene datos del ciudadano y la consulta el servicio por
 * `tenant`. El secreto va cifrado en reposo (AES-256-GCM, common/secretos.ts).
 */
export class ConfigEls1807000000000 implements MigrationInterface {
  name = 'ConfigEls1807000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS config_els (
        id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant            varchar(64)  NOT NULL UNIQUE,
        "baseUrl"         varchar(200),
        agencia           varchar(80),
        "clienteId"       varchar(200),
        "clienteSecreto"  varchar(500),
        "casoPorDefecto"  varchar(80),
        activo            boolean      NOT NULL DEFAULT true,
        "actualizadoPor"  varchar(120),
        "actualizadoEn"   timestamptz  NOT NULL DEFAULT now()
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS config_els`);
  }
}
