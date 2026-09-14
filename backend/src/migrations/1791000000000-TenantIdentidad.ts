import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identidad territorial (DIVIPOLA/DANE) y de marca por tenant. Antes el alta
 * de un tenant solo pedía código y nombre — insuficiente para reportes que
 * agrupen/crucen por departamento, municipio o región, y sin forma de darle
 * identidad visual propia (bandera/logo) dentro del sistema.
 */
export class TenantIdentidad1791000000000 implements MigrationInterface {
  name = 'TenantIdentidad1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "codigoDane" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "departamento" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "municipio" character varying(120)`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subregion" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logoDataUrl" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "logoDataUrl"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "subregion"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "municipio"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "departamento"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "codigoDane"`);
  }
}
