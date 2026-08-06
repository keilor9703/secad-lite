import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suscripción del tenant: plan, estado comercial, vencimiento, motivo de
 * bloqueo e integraciones habilitadas. Los tenants existentes quedan activos
 * con todas las integraciones, para no cortarle el servicio a nadie al migrar.
 */
export class Suscripcion1786055111000 implements MigrationInterface {
  name = 'Suscripcion1786055111000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" ADD "plan" character varying(40) NOT NULL DEFAULT 'basico'`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "suscripcion" character varying(20) NOT NULL DEFAULT 'prueba'`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "vence" date`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "motivoBloqueo" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD "integraciones" text`);
    await queryRunner.query(`UPDATE "tenants" SET "suscripcion" = 'activa', "integraciones" = 'pbx,whatsapp,api'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['integraciones', 'motivoBloqueo', 'vence', 'suscripcion', 'plan']) {
      await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "${c}"`);
    }
  }
}
