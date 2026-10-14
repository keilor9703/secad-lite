import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correo del funcionario y enlaces de un solo uso para poner contraseña.
 *
 * Lo que habilita: crear una cuenta SIN contraseña y que su dueño elija la
 * suya por invitación, y que quien la olvide la recupere sin despertar a un
 * administrador a las tres de la mañana.
 *
 * El correo va nullable y sin unicidad, las dos cosas a propósito: nullable
 * porque todas las cuentas existentes no lo tienen y exigirlo las romperia;
 * sin unicidad porque hay oficinas pequeñas que comparten un solo buzón
 * institucional, y no hay nada que proteger — la recuperación se pide por
 * username, nunca por correo.
 */
export class CorreoYCredenciales1814000000000 implements MigrationInterface {
  name = 'CorreoYCredenciales1814000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS "correo" varchar(200),
        ADD COLUMN IF NOT EXISTS "correoVerificadoEn" timestamptz,
        ADD COLUMN IF NOT EXISTS "correoRebotadoEn" timestamptz,
        ADD COLUMN IF NOT EXISTS "correoRebotadoMotivo" varchar(300),
        ADD COLUMN IF NOT EXISTS "invitacionEnviadaEn" timestamptz,
        ADD COLUMN IF NOT EXISTS "invitacionError" varchar(300)
    `);
    // Buscar por correo pasa en cada rebote que reporta el proveedor.
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "idx_usuarios_correo" ON usuarios ("correo") WHERE "correo" IS NOT NULL',
    );

    await runner.query(`
      CREATE TABLE IF NOT EXISTS credenciales_token (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "usuarioId" uuid NOT NULL,
        "tipo" varchar(20) NOT NULL,
        "tokenHash" varchar(64) NOT NULL,
        "venceEn" timestamptz NOT NULL,
        "usadoEn" timestamptz,
        "anuladoEn" timestamptz,
        "creadoEn" timestamptz NOT NULL DEFAULT now(),
        "creadoPor" varchar(120)
      )
    `);
    // Único: es la vía de búsqueda, y dos filas con el mismo hash harían
    // ambiguo qué cuenta abre un enlace.
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ux_credtoken_hash" ON credenciales_token ("tokenHash")',
    );
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "idx_credtoken_usuario" ON credenciales_token ("usuarioId")',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS credenciales_token');
    await runner.query('DROP INDEX IF EXISTS "idx_usuarios_correo"');
    await runner.query(`
      ALTER TABLE usuarios
        DROP COLUMN IF EXISTS "correo",
        DROP COLUMN IF EXISTS "correoVerificadoEn",
        DROP COLUMN IF EXISTS "correoRebotadoEn",
        DROP COLUMN IF EXISTS "correoRebotadoMotivo",
        DROP COLUMN IF EXISTS "invitacionEnviadaEn",
        DROP COLUMN IF EXISTS "invitacionError"
    `);
  }
}
