import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LA SALUD DE CADA PLANTA, MEDIDA DESDE FUERA.
 *
 * Hasta ahora no existía nada: si la troncal se caía a las tres de la mañana,
 * nadie se enteraba hasta que alguien llamaba a quejarse. Y la noche del 19 de
 * octubre dejó claro que una planta puede estar «arriba» —contenedor
 * corriendo, puerto escuchando— y no servir para nada.
 *
 * Una fila por planta y no un histórico: lo que hace falta para operar es
 * «¿está bien ahora?» y «¿desde cuándo está mal?». Un chequeo cada cinco
 * minutos son cien mil filas al año por municipio para responder preguntas que
 * nadie hace.
 *
 * `fallaDesde` es lo que convierte esto en algo operable: sin él, una caída de
 * dos días y una de dos minutos se ven igual.
 */
export class SaludDeLaPlanta1822000000000 implements MigrationInterface {
  name = 'SaludDeLaPlanta1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "planta_salud" (
        "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant"            character varying(64) NOT NULL,
        "bien"              boolean NOT NULL DEFAULT false,
        "fallas"            text[] NOT NULL DEFAULT '{}',
        "version"           character varying(120),
        "operadores"        integer NOT NULL DEFAULT 0,
        "certificadoVence"  TIMESTAMP WITH TIME ZONE,
        "fallaDesde"        TIMESTAMP WITH TIME ZONE,
        "avisadoEn"         TIMESTAMP WITH TIME ZONE,
        "avisadoDe"         text[] NOT NULL DEFAULT '{}',
        "detalle"           text,
        "revisadoEn"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_planta_salud" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_planta_salud_tenant" UNIQUE ("tenant")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "planta_salud"`);
  }
}
