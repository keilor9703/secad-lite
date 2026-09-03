import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "@" de WhatsApp por funcionario, para vincular conversaciones que lleguen
 * por la integración CTI/YACO al operador dueño de ese handle — mismo
 * propósito que `extension` para PBX.
 */
export class WhatsappHandle1787400000000 implements MigrationInterface {
  name = 'WhatsappHandle1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "whatsappHandle" character varying(80)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "whatsappHandle"`);
  }
}
