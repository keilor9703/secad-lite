import { MigrationInterface, QueryRunner } from 'typeorm';

/** Solicitud de reapertura: quién la pidió, cuándo y por qué. */
export class Reapertura1786054376000 implements MigrationInterface {
  name = 'Reapertura1786054376000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD "reaperturaSolicitada" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "reaperturaMotivo" text`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "reaperturaSolicitadaPor" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD "reaperturaSolicitadaEn" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['reaperturaSolicitadaEn', 'reaperturaSolicitadaPor', 'reaperturaMotivo', 'reaperturaSolicitada']) {
      await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN "${c}"`);
    }
  }
}
