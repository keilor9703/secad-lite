import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * URL de grabación/transcripción asociadas al caso (integración CTI/YACO).
 * Visibilidad restringida por el permiso `casos.ver_grabaciones` — ver
 * CasosController.
 */
export class GrabacionCaso1787500000000 implements MigrationInterface {
  name = 'GrabacionCaso1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "urlGrabacion" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "urlTranscripcion" character varying(500)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "urlTranscripcion"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "urlGrabacion"`);
  }
}
