import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Campos del formulario de recepción del CAD: tipificación (código de caso y
 * prioridad), ubicación del incidente y a quién se envía (agencia de origen,
 * agencia responsable y canales de atención).
 */
export class CasoCad1786046448000 implements MigrationInterface {
  name = 'CasoCad1786046448000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD "codigoCaso" character varying(16)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "prioridad" character varying(10) NOT NULL DEFAULT 'media'`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "direccionLlamante" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "ciudad" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "barrio" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "direccion" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "agenciaOrigenId" uuid`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "agenciaResponsableId" uuid`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "canales" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['canales', 'agenciaResponsableId', 'agenciaOrigenId', 'direccion', 'barrio', 'ciudad', 'direccionLlamante', 'prioridad', 'codigoCaso']) {
      await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN "${col}"`);
    }
  }
}
