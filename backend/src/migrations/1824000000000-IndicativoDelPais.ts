import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EL INDICATIVO DEL PAÍS DE LA PLANTA.
 *
 * Arregla que el plan de marcación le pegara un «+» a cualquier número que
 * llegara sin él. Un celular colombiano escrito como `3175882321` —que es
 * como lo teclea un operador al tomar una emergencia, y como queda guardado
 * en el caso— salía marcado como `+3175882321`, que no es E.164 de ningún
 * país. El operador contestó `484 Address Incomplete`, con toda la razón.
 *
 * Medido contra Infobip el 20 de octubre de 2026.
 *
 * Nula a propósito: nula significa 57, y así las plantas que ya existen no
 * cambian de comportamiento con esta migración. Es un campo y no una
 * constante porque el generador es multi-municipio y algún día puede no ser
 * solo Colombia.
 */
export class IndicativoDelPais1824000000000 implements MigrationInterface {
  name = 'IndicativoDelPais1824000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" ADD COLUMN IF NOT EXISTS "indicativoPais" character varying(4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "planta_asterisk" DROP COLUMN IF EXISTS "indicativoPais"`,
    );
  }
}
