import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1785286805405 implements MigrationInterface {
    name = 'Init1785286805405'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "casos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "canal" character varying(20) NOT NULL, "titulo" character varying(160) NOT NULL, "descripcion" text NOT NULL DEFAULT '', "ciudadano" character varying(120) NOT NULL, "telefono" character varying(40), "agencia" character varying(80) NOT NULL DEFAULT 'Central', "estado" character varying(20) NOT NULL DEFAULT 'nuevo', "creadoPor" character varying(120) NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e53891d55a545d106d0c71d2155" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d9e9a5ae2ac38dc25cb071017b" ON "casos" ("tenant") `);
        await queryRunner.query(`CREATE INDEX "IDX_13d2bb8641e98d8b8b275d7d8f" ON "casos" ("tenant", "estado") `);
        await queryRunner.query(`CREATE TABLE "casos_eventos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "casoId" uuid NOT NULL, "tipo" character varying(20) NOT NULL, "descripcion" text NOT NULL, "estadoAnterior" character varying(20), "estadoNuevo" character varying(20), "autor" character varying(120) NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ef2d9bd71fecc436dc846902901" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6f0dfea2967fcf2f33ecf858f9" ON "casos_eventos" ("tenant", "casoId", "creadoEn") `);
        await queryRunner.query(`CREATE TABLE "usuarios" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "username" character varying(120) NOT NULL, "passwordHash" character varying(200) NOT NULL, "nombre" character varying(120) NOT NULL, "rol" character varying(20) NOT NULL DEFAULT 'operador', "tipo" character varying(20) NOT NULL DEFAULT 'institucional', "activo" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d7281c63c176e152e4c531594a8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ffab27db3b0278827615b634e2" ON "usuarios" ("tenant", "username") `);
        await queryRunner.query(`CREATE TABLE "casos_mensajes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "casoId" uuid NOT NULL, "autorTipo" character varying(20) NOT NULL, "autorNombre" character varying(120) NOT NULL, "texto" text NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eeb79a3640990416dd0fe8f8a60" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_839c3988f6a5d34fc5220328f3" ON "casos_mensajes" ("tenant", "casoId", "creadoEn") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_839c3988f6a5d34fc5220328f3"`);
        await queryRunner.query(`DROP TABLE "casos_mensajes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ffab27db3b0278827615b634e2"`);
        await queryRunner.query(`DROP TABLE "usuarios"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6f0dfea2967fcf2f33ecf858f9"`);
        await queryRunner.query(`DROP TABLE "casos_eventos"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_13d2bb8641e98d8b8b275d7d8f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9e9a5ae2ac38dc25cb071017b"`);
        await queryRunner.query(`DROP TABLE "casos"`);
    }

}
