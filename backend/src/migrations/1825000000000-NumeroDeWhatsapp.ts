import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EL NÚMERO DE WHATSAPP DE LA INSTANCIA.
 *
 * Hace falta porque los dos caminos de entrada identifican la línea con
 * cosas distintas: Meta Cloud API manda su `phone_number_id`, e Infobip
 * —como proveedor oficial— manda el número de destino tal cual, porque para
 * ellos la línea ES el número.
 *
 * Único: dos instancias no pueden compartir una línea de WhatsApp. Si
 * pudieran, un mensaje entrante no tendría forma de saber a qué municipio
 * pertenece, y eso en un sistema sin Row-Level Security es una fuga de datos
 * entre municipios, que es el peor error posible en este repositorio.
 */
export class NumeroDeWhatsapp1825000000000 implements MigrationInterface {
  name = 'NumeroDeWhatsapp1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "waNumero" character varying(24)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_waNumero" ON "tenants" ("waNumero")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_waNumero"`);
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN IF EXISTS "waNumero"`,
    );
  }
}
