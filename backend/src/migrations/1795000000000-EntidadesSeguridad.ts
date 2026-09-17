import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Endurece la API entrante de entidades externas contra el reparto de la
 * `x-api-key`: una API key es un secreto compartido, así que nada impide que
 * la entidad dueña la copie a otra de sus apps o incluso a un tercero. Esta
 * migración agrega dos controles independientes de esa key:
 *
 * 1. Allowlist de IP/CIDR por entidad (`ipsPermitidas`): si se configura, la
 *    key deja de funcionar fuera de esas IPs, aunque se haya filtrado.
 *    NULL/vacío = sin restricción (no rompe entidades ya registradas).
 * 2. Telemetría de uso (`ultimoUso`, `ultimaIp`, `ipsVistas`): sin allowlist,
 *    o mientras se decide si configurarlo, esto permite notar en
 *    Administración que una entidad está llamando desde más IPs de las
 *    esperadas — señal de que la key circula más de lo pensado.
 */
export class EntidadesSeguridad1795000000000 implements MigrationInterface {
  name = 'EntidadesSeguridad1795000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE entidades
        ADD COLUMN IF NOT EXISTS "ipsPermitidas" text,
        ADD COLUMN IF NOT EXISTS "ultimoUso" timestamptz,
        ADD COLUMN IF NOT EXISTS "ultimaIp" varchar(64),
        ADD COLUMN IF NOT EXISTS "ipsVistas" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE entidades
        DROP COLUMN IF EXISTS "ipsPermitidas",
        DROP COLUMN IF EXISTS "ultimoUso",
        DROP COLUMN IF EXISTS "ultimaIp",
        DROP COLUMN IF EXISTS "ipsVistas"
    `);
  }
}
