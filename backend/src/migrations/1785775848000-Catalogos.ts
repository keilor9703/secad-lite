import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogos operativos del secad: agencias (entidades que atienden), sus
 * canales de atención y los códigos de caso. Además adscribe al funcionario a
 * una agencia y a los canales que atiende.
 */
export class Catalogos1785775848000 implements MigrationInterface {
  name = 'Catalogos1785775848000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agencias" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "codigo" character varying(32) NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "tipo" character varying(20) NOT NULL DEFAULT 'otra',
        "telefono" character varying(40),
        "activo" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_agencias" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_agencias_tenant" ON "agencias" ("tenant")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_agencias_tenant_codigo" ON "agencias" ("tenant", "codigo")`);

    await queryRunner.query(`
      CREATE TABLE "canales" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "agenciaId" uuid NOT NULL,
        "codigo" character varying(32) NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_canales" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_canales_tenant" ON "canales" ("tenant")`);
    await queryRunner.query(`CREATE INDEX "IDX_canales_tenant_agencia" ON "canales" ("tenant", "agenciaId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_canales_tenant_agencia_codigo" ON "canales" ("tenant", "agenciaId", "codigo")`);

    await queryRunner.query(`
      CREATE TABLE "codigos_caso" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "codigo" character varying(16) NOT NULL,
        "descripcion" character varying(160) NOT NULL,
        "prioridad" character varying(10) NOT NULL DEFAULT 'media',
        "agenciaSugeridaId" uuid,
        "activo" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_codigos_caso" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_codigos_caso_tenant" ON "codigos_caso" ("tenant")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_codigos_caso_tenant_codigo" ON "codigos_caso" ("tenant", "codigo")`);

    await queryRunner.query(`ALTER TABLE "usuarios" ADD "agenciaId" uuid`);
    await queryRunner.query(`ALTER TABLE "usuarios" ADD "canales" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "canales"`);
    await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "agenciaId"`);
    await queryRunner.query(`DROP TABLE "codigos_caso"`);
    await queryRunner.query(`DROP TABLE "canales"`);
    await queryRunner.query(`DROP TABLE "agencias"`);
  }
}
