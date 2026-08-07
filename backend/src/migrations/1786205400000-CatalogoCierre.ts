import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los códigos de cierre dejan de estar fijos en el código y pasan a ser un
 * catálogo por secad. Se siembra a cada tenant existente la lista que estaba
 * hardcodeada, para que ningún caso ya cerrado quede apuntando a una clave
 * que el catálogo desconoce.
 */
export class CatalogoCierre1786205400000 implements MigrationInterface {
  name = 'CatalogoCierre1786205400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "codigos_cierre" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant" character varying(64) NOT NULL,
        "codigo" character varying(32) NOT NULL,
        "etiqueta" character varying(120) NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_codigos_cierre" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_codigos_cierre_tenant" ON "codigos_cierre" ("tenant")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_codigos_cierre_tenant_codigo" ON "codigos_cierre" ("tenant", "codigo")`);

    // Un juego de desenlaces por cada secad que ya tenga catálogo operativo.
    await queryRunner.query(`
      INSERT INTO "codigos_cierre" ("tenant", "codigo", "etiqueta")
      SELECT t."tenant", v."codigo", v."etiqueta"
        FROM (SELECT DISTINCT "tenant" FROM "agencias") t
        CROSS JOIN (VALUES
          ('atendido',     'Atendido efectivamente'),
          ('falsa_alarma', 'Falsa alarma'),
          ('sin_merito',   'Sin mérito / no procede'),
          ('duplicado',    'Caso duplicado'),
          ('remitido',     'Remitido a otra entidad'),
          ('sin_recurso',  'Sin recurso disponible'),
          ('desistido',    'El ciudadano desiste'),
          ('informativo',  'Solo informativo')
        ) AS v("codigo", "etiqueta")
      ON CONFLICT DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "codigos_cierre"`);
  }
}
