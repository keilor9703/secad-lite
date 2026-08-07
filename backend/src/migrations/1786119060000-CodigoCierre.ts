import { MigrationInterface, QueryRunner } from 'typeorm';

/** Clasificación del cierre: es lo que permite contar los casos por desenlace. */
export class CodigoCierre1786119060000 implements MigrationInterface {
  name = 'CodigoCierre1786119060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD "codigoCierre" character varying(32)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN "codigoCierre"`);
  }
}
