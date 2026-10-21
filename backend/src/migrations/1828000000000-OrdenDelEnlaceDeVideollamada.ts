import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CADA MUNICIPIO ELIGE POR DÓNDE LE SALE EL ENLACE DE LA VIDEOLLAMADA.
 *
 * Hasta ahora el orden estaba escrito en el código: WhatsApp libre, plantilla
 * aprobada, SMS. Es un orden razonable, pero no es el correcto para todos: un
 * municipio con SMS incluido en su plan lo quiere primero por fiabilidad, y
 * otro que paga cada mensaje lo quiere al final.
 *
 * `NULL` —el valor con el que quedan todas las instancias existentes—
 * significa «que decida el sistema», así que esta migración no cambia el
 * comportamiento de nadie. La columna solo guarda algo cuando un
 * administrador elige un orden distinto del automático.
 */
export class OrdenDelEnlaceDeVideollamada1828000000000 implements MigrationInterface {
  name = 'OrdenDelEnlaceDeVideollamada1828000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "ordenEnlaceVideollamada" character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants" DROP COLUMN IF EXISTS "ordenEnlaceVideollamada"
    `);
  }
}
