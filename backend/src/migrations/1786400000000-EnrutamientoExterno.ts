import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A quién se envían los casos que entran por integraciones externas
 * (Entidades API y WhatsApp): agencia responsable del catálogo y sus canales
 * de atención. Sin esto, esos casos quedaban sin canal y solo los veía un
 * supervisor (casos.ver_todos) — nunca un operador de despacho normal.
 */
export class EnrutamientoExterno1786400000000 implements MigrationInterface {
  name = 'EnrutamientoExterno1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "entidades" ADD "agenciaResponsableId" uuid`);
    await queryRunner.query(`ALTER TABLE "entidades" ADD "canales" text`);

    await queryRunner.query(`ALTER TABLE "tenants" ADD "waAgenciaResponsableId" uuid`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "waCanales" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "waCanales"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "waAgenciaResponsableId"`);

    await queryRunner.query(`ALTER TABLE "entidades" DROP COLUMN "canales"`);
    await queryRunner.query(`ALTER TABLE "entidades" DROP COLUMN "agenciaResponsableId"`);
  }
}
