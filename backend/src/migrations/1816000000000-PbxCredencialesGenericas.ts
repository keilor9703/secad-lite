import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Las credenciales de la planta telefónica dejan de ser columnas de Zadarma.
 *
 * `config_pbx` nació con `zadarmaKey` y `zadarmaSecreto` porque Zadarma era el
 * único proveedor con credenciales. Eso hacía que cada proveedor nuevo
 * —Infobip, el que venga— costara dos columnas, una migración, un trozo de
 * pantalla escrito a mano y una rama más en el servicio de configuración.
 *
 * Ahora cada proveedor declara sus campos en su descriptor
 * (`proveedores/*.proveedor.ts`) y aquí se guarda un JSON con lo que diga.
 * Los campos secretos siguen cifrados exactamente igual: **el valor cifrado se
 * copia tal cual**, sin descifrar ni volver a cifrar, así que la llave de
 * cifrado no participa en esta migración y no hay forma de que un `JWT_SECRET`
 * distinto en el servidor arruine el traslado.
 *
 * `proveedor` pasa de varchar(16) a varchar(32): las claves las define el
 * registro, y 16 caracteres ya quedaban cortos para un nombre cualquiera.
 */
export class PbxCredencialesGenericas1816000000000 implements MigrationInterface {
  name = 'PbxCredencialesGenericas1816000000000';

  public async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE config_pbx ADD COLUMN IF NOT EXISTS credenciales text');
    await runner.query('ALTER TABLE config_pbx ALTER COLUMN proveedor TYPE varchar(32)');

    // El traslado. `jsonb_strip_nulls` evita guardar `{"secreto": null}`, que
    // al leerse parecería una credencial puesta y vacía.
    await runner.query(`
      UPDATE config_pbx
         SET credenciales = jsonb_strip_nulls(jsonb_build_object(
               'key',     NULLIF("zadarmaKey", ''),
               'secreto', NULLIF("zadarmaSecreto", '')
             ))::text
       WHERE credenciales IS NULL
         AND (NULLIF("zadarmaKey", '') IS NOT NULL OR NULLIF("zadarmaSecreto", '') IS NOT NULL)
    `);

    await runner.query('ALTER TABLE config_pbx DROP COLUMN IF EXISTS "zadarmaKey"');
    await runner.query('ALTER TABLE config_pbx DROP COLUMN IF EXISTS "zadarmaSecreto"');
  }

  /**
   * De vuelta, sin pérdida: las dos columnas se recrean y se vuelven a llenar
   * desde el JSON. Un proveedor que no sea Zadarma no tiene dónde volver —sus
   * campos no caben en dos columnas con nombre de Zadarma—, y eso es lo
   * esperable: la vuelta sirve para deshacer este despliegue, no para
   * convivir con proveedores que se dieron de alta después.
   */
  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE config_pbx ADD COLUMN IF NOT EXISTS "zadarmaKey" varchar(120)');
    await runner.query('ALTER TABLE config_pbx ADD COLUMN IF NOT EXISTS "zadarmaSecreto" varchar(500)');
    await runner.query(`
      UPDATE config_pbx
         SET "zadarmaKey"     = credenciales::jsonb ->> 'key',
             "zadarmaSecreto" = credenciales::jsonb ->> 'secreto'
       WHERE credenciales IS NOT NULL AND proveedor = 'ZADARMA'
    `);
    await runner.query('ALTER TABLE config_pbx DROP COLUMN IF EXISTS credenciales');
    await runner.query("ALTER TABLE config_pbx ALTER COLUMN proveedor TYPE varchar(16)");
  }
}
