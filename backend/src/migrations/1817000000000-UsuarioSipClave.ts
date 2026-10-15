import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `usuarios.sipClave`: la credencial SIP de cada extensión.
 *
 * Hace falta para contestar DENTRO de FALCON: el navegador del operador se
 * registra como teléfono en la central, y para eso necesita la clave de SU
 * extensión. Es por usuario y no por instancia porque cada extensión tiene la
 * suya; con una compartida, dos operadores se registrarían como el mismo
 * teléfono y la central entregaría la llamada a cualquiera de los dos.
 *
 * Va cifrada en reposo, no como digest: hay que poder recuperarla para
 * entregarla al navegador. Nula en todas las filas existentes, así que nadie
 * queda con softphone hasta que un administrador la registre.
 */
export class UsuarioSipClave1817000000000 implements MigrationInterface {
  name = 'UsuarioSipClave1817000000000';

  public async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS "sipClave" varchar(500)');
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE usuarios DROP COLUMN IF EXISTS "sipClave"');
  }
}
