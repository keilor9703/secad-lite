import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El `username` deja de ser único a nivel global y pasa a serlo DENTRO de
 * cada tenant: dos secads distintos pueden tener cada uno su propio "admin"
 * sin chocar entre sí. El índice único global impedía crear en un tenant un
 * usuario cuyo nombre ya existiera en cualquier OTRO tenant (409 aunque no
 * hubiera conflicto real). El login, que no conoce el tenant de antemano,
 * ahora prueba la contraseña contra cada cuenta activa con ese username
 * (ver `UsuariosService.validar`).
 */
export class UsernamePorTenant1786500000000 implements MigrationInterface {
  name = 'UsernamePorTenant1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_9f78cfde576fc28f279e2b7a9c"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_usuarios_tenant_username" ON "usuarios" ("tenant", "username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_usuarios_tenant_username"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9f78cfde576fc28f279e2b7a9c" ON "usuarios" ("username")`,
    );
  }
}
