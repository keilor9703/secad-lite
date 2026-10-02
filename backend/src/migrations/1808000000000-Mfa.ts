import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Doble factor de autenticación (TOTP).
 *
 * El secreto vive en la fila del usuario, cifrado en reposo (AES-256-GCM, ver
 * common/secretos.ts). No va en tabla aparte porque es un atributo del
 * usuario, no una entidad propia, y así hereda sin más la RLS de `usuarios`.
 *
 * `mfaUltimoContador` guarda el paso de tiempo del último código aceptado:
 * es lo que impide que el MISMO código sirva dos veces dentro de su ventana.
 *
 * config_mfa es la política de la plataforma, una sola fila, como config_sms
 * y config_els. Arranca exigiendo 2FA.
 */
export class Mfa1808000000000 implements MigrationInterface {
  name = 'Mfa1808000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS "mfaSecreto"          varchar(500),
        ADD COLUMN IF NOT EXISTS "mfaActivadoEn"       timestamptz,
        ADD COLUMN IF NOT EXISTS "mfaUltimoContador"   bigint,
        ADD COLUMN IF NOT EXISTS "mfaIntentosFallidos" integer     NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "mfaBloqueoHasta"     timestamptz
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS config_mfa (
        id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant           varchar(64)  NOT NULL UNIQUE,
        exigido          boolean      NOT NULL DEFAULT true,
        "actualizadoPor" varchar(120),
        "actualizadoEn"  timestamptz  NOT NULL DEFAULT now()
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS config_mfa`);
    await runner.query(`
      ALTER TABLE usuarios
        DROP COLUMN IF EXISTS "mfaSecreto",
        DROP COLUMN IF EXISTS "mfaActivadoEn",
        DROP COLUMN IF EXISTS "mfaUltimoContador",
        DROP COLUMN IF EXISTS "mfaIntentosFallidos",
        DROP COLUMN IF EXISTS "mfaBloqueoHasta"
    `);
  }
}
