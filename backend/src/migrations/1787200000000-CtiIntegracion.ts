import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Integración CTI/YACO (barra embebida): clave de API dedicada por tenant,
 * separada de la de PBX. 'cti' se habilita explícitamente en `integraciones`
 * por tenant (no se agrega a los existentes por defecto: es una integración
 * nueva y opcional, el modo clásico de PBX/WhatsApp sigue intacto).
 */
export class CtiIntegracion1787200000000 implements MigrationInterface {
  name = 'CtiIntegracion1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "ctiApiKey" character varying(80)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_ctiApiKey" ON "tenants" ("ctiApiKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_ctiApiKey"`);
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "ctiApiKey"`);
  }
}
