import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Concede `usuarios.mfa_restablecer` a los roles que YA administran usuarios.
 *
 * Sin esto, el permiso existiría en el catálogo pero nadie lo tendría, y habría
 * que entrar a editar el rol de administrador de cada municipio a mano antes de
 * que la función sirviera para algo.
 *
 * No amplía el poder de nadie: quien tiene `usuarios.gestionar` ya puede
 * restablecer la contraseña de una cuenta, que es una llave MÁS fuerte —con ella
 * entra; con el doble factor restablecido, todavía necesita la contraseña—. El
 * permiso aparte existe para que la capacidad se conceda a conciencia y quede
 * separada en la bitácora, no porque abra una puerta nueva.
 *
 * `permisos` es un simple-array de TypeORM: texto con comas. Se compara contra
 * el array real en vez de con LIKE, que daría falsos positivos con cualquier
 * permiso que contenga a otro como subcadena.
 */
export class PermisoRestablecerMfa1809000000000 implements MigrationInterface {
  name = 'PermisoRestablecerMfa1809000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE roles
         SET permisos = permisos || ',usuarios.mfa_restablecer'
       WHERE permisos IS NOT NULL
         AND 'usuarios.gestionar' = ANY(string_to_array(permisos, ','))
         AND NOT ('usuarios.mfa_restablecer' = ANY(string_to_array(permisos, ',')))
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      UPDATE roles
         SET permisos = array_to_string(
               array_remove(string_to_array(permisos, ','), 'usuarios.mfa_restablecer'), ',')
       WHERE permisos IS NOT NULL
         AND 'usuarios.mfa_restablecer' = ANY(string_to_array(permisos, ','))
    `);
  }
}
