import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El username dejó de ser único solo dentro de cada tenant para serlo en
 * toda la plataforma: dos secads no pueden tener cada uno un "carlos"
 * propio (evita que un mismo usuario/contraseña caiga ambiguamente en dos
 * tenants al iniciar sesión). Reemplaza el índice único (tenant, username)
 * por uno único en username solo.
 *
 * Una instancia que ya tenga usernames duplicados entre tenants (creados
 * antes de esta restricción) no puede recibir el índice único sin antes
 * resolver el choque a mano — en ese caso se deja una advertencia en el log
 * de la migración y NO se crea el índice; la instancia sigue funcionando
 * igual que antes (la validación de `UsuariosService.crear` sí aplica desde
 * ya para cuentas nuevas) hasta que alguien libere los duplicados y se
 * vuelva a correr la migración.
 */
export class UsernameUnicoGlobal1792000000000 implements MigrationInterface {
  name = 'UsernameUnicoGlobal1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // El índice compuesto anterior lo creó `synchronize` en instalaciones
    // viejas con un nombre autogenerado por TypeORM (no siempre el mismo) —
    // se busca por definición, no por nombre fijo.
    await queryRunner.query(`
      DO $$
      DECLARE idx text;
      BEGIN
        SELECT indexname INTO idx FROM pg_indexes
         WHERE tablename = 'usuarios' AND indexdef ILIKE '%UNIQUE%'
           AND indexdef ILIKE '%tenant%' AND indexdef ILIKE '%username%';
        IF idx IS NOT NULL THEN
          EXECUTE format('DROP INDEX IF EXISTS %I', idx);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      DECLARE duplicados integer;
      BEGIN
        SELECT count(*) INTO duplicados FROM (
          SELECT username FROM usuarios GROUP BY username HAVING count(*) > 1
        ) t;
        IF duplicados = 0 THEN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'usuarios' AND indexname = 'UQ_usuarios_username') THEN
            CREATE UNIQUE INDEX "UQ_usuarios_username" ON usuarios (username);
          END IF;
        ELSE
          RAISE WARNING 'usuarios: hay % nombre(s) de usuario repetidos entre tenants distintos — no se creó el índice único global hasta corregirlos a mano.', duplicados;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_usuarios_username"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_usuarios_tenant_username" ON usuarios (tenant, username)`);
  }
}
