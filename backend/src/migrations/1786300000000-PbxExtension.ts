import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enrutamiento de llamadas por extensión: el ACD de la central decide a qué
 * operador dirigir cada llamada; aquí solo se guarda el mapeo extensión →
 * funcionario y, en cada llamada entrante, a quién quedó dirigida.
 */
export class PbxExtension1786300000000 implements MigrationInterface {
  name = 'PbxExtension1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usuarios" ADD "extension" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "llamadas" ADD "extension" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "llamadas" ADD "destinatario" character varying(120)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "llamadas" DROP COLUMN "destinatario"`);
    await queryRunner.query(`ALTER TABLE "llamadas" DROP COLUMN "extension"`);
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "extension"`);
  }
}
