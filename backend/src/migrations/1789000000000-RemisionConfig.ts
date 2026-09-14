import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A dónde llega, en ESTE tenant, un caso remitido desde otra jurisdicción:
 * agencia responsable y canales (mismo patrón que waAgenciaResponsableId /
 * waCanales para WhatsApp). Sin esto, remitirATenant() lo deja sin asignar.
 */
export class RemisionConfig1789000000000 implements MigrationInterface {
  name = 'RemisionConfig1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "remisionAgenciaResponsableId" uuid`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "remisionCanales" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "remisionAgenciaResponsableId"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "remisionCanales"`);
  }
}
