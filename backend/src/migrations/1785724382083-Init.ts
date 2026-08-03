import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1785724382083 implements MigrationInterface {
    name = 'Init1785724382083'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "casos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "canal" character varying(20) NOT NULL, "titulo" character varying(160) NOT NULL, "descripcion" text NOT NULL DEFAULT '', "ciudadano" character varying(120) NOT NULL, "telefono" character varying(40), "agencia" character varying(80) NOT NULL DEFAULT 'Central', "lat" double precision, "lng" double precision, "estado" character varying(20) NOT NULL DEFAULT 'nuevo', "creadoPor" character varying(120) NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e53891d55a545d106d0c71d2155" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d9e9a5ae2ac38dc25cb071017b" ON "casos" ("tenant") `);
        await queryRunner.query(`CREATE INDEX "IDX_13d2bb8641e98d8b8b275d7d8f" ON "casos" ("tenant", "estado") `);
        await queryRunner.query(`CREATE TABLE "casos_eventos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "casoId" uuid NOT NULL, "tipo" character varying(20) NOT NULL, "descripcion" text NOT NULL, "estadoAnterior" character varying(20), "estadoNuevo" character varying(20), "autor" character varying(120) NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ef2d9bd71fecc436dc846902901" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6f0dfea2967fcf2f33ecf858f9" ON "casos_eventos" ("tenant", "casoId", "creadoEn") `);
        await queryRunner.query(`CREATE TABLE "usuarios" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying(120) NOT NULL, "tenant" character varying(64), "passwordHash" character varying(200) NOT NULL, "nombre" character varying(120) NOT NULL, "rol" character varying(40) NOT NULL DEFAULT 'operador', "activo" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d7281c63c176e152e4c531594a8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9f78cfde576fc28f279e2b7a9c" ON "usuarios" ("username") `);
        await queryRunner.query(`CREATE TABLE "casos_mensajes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "casoId" uuid NOT NULL, "autorTipo" character varying(20) NOT NULL, "autorNombre" character varying(120) NOT NULL, "texto" text NOT NULL, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eeb79a3640990416dd0fe8f8a60" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_839c3988f6a5d34fc5220328f3" ON "casos_mensajes" ("tenant", "casoId", "creadoEn") `);
        await queryRunner.query(`CREATE TABLE "tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "codigo" character varying(64) NOT NULL, "nombre" character varying(160) NOT NULL, "apiKey" character varying(80), "waPhoneNumberId" character varying(40), "waAccessToken" character varying(400), "activo" boolean NOT NULL DEFAULT true, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7f300745cb2da34b4b9bc45157" ON "tenants" ("codigo") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_30dec5cd2d1f58a2682a9c77bb" ON "tenants" ("apiKey") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7afc257bd8680b6562a358a440" ON "tenants" ("waPhoneNumberId") `);
        await queryRunner.query(`CREATE TABLE "recursos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "codigo" character varying(32) NOT NULL, "nombre" character varying(120) NOT NULL, "tipo" character varying(20) NOT NULL DEFAULT 'patrulla', "agencia" character varying(80) NOT NULL DEFAULT 'Central', "estado" character varying(20) NOT NULL DEFAULT 'disponible', "lat" double precision, "lng" double precision, "activo" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_5a0d9a8e3adc0a5c2961159930a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_537435aaa4246b904325667807" ON "recursos" ("tenant", "codigo") `);
        await queryRunner.query(`CREATE INDEX "IDX_4e477718cf51454e5966b0cabf" ON "recursos" ("tenant", "estado") `);
        await queryRunner.query(`CREATE TABLE "asignaciones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "casoId" uuid NOT NULL, "recursoId" uuid NOT NULL, "recursoCodigo" character varying(32) NOT NULL, "recursoNombre" character varying(120) NOT NULL, "estado" character varying(20) NOT NULL DEFAULT 'asignado', "asignadoPor" character varying(120) NOT NULL, "motivo" character varying(200), "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c11ab1a82249192bc2e2763d3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0baa69435e64031825facd725f" ON "asignaciones" ("tenant", "casoId") `);
        await queryRunner.query(`CREATE TABLE "llamadas" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "callId" character varying(120), "numero" character varying(40) NOT NULL, "numeroDestino" character varying(40), "estado" character varying(20) NOT NULL DEFAULT 'sonando', "casoId" uuid, "atendidaPor" character varying(120), "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actualizadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_44c73ed9bd55ccada0391a2da0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7a0c10f7ab48abe4e9c1e71e1d" ON "llamadas" ("callId") `);
        await queryRunner.query(`CREATE INDEX "IDX_066cfbf0de4fa2ae041cd31a61" ON "llamadas" ("tenant", "estado") `);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant" character varying(64) NOT NULL, "codigo" character varying(40) NOT NULL, "nombre" character varying(80) NOT NULL, "permisos" text, "esSistema" boolean NOT NULL DEFAULT false, "creadoEn" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a4a3e2c74ae3eed8b33a456061" ON "roles" ("tenant", "codigo") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_a4a3e2c74ae3eed8b33a456061"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_066cfbf0de4fa2ae041cd31a61"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a0c10f7ab48abe4e9c1e71e1d"`);
        await queryRunner.query(`DROP TABLE "llamadas"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0baa69435e64031825facd725f"`);
        await queryRunner.query(`DROP TABLE "asignaciones"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4e477718cf51454e5966b0cabf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_537435aaa4246b904325667807"`);
        await queryRunner.query(`DROP TABLE "recursos"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7afc257bd8680b6562a358a440"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30dec5cd2d1f58a2682a9c77bb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f300745cb2da34b4b9bc45157"`);
        await queryRunner.query(`DROP TABLE "tenants"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_839c3988f6a5d34fc5220328f3"`);
        await queryRunner.query(`DROP TABLE "casos_mensajes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9f78cfde576fc28f279e2b7a9c"`);
        await queryRunner.query(`DROP TABLE "usuarios"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6f0dfea2967fcf2f33ecf858f9"`);
        await queryRunner.query(`DROP TABLE "casos_eventos"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_13d2bb8641e98d8b8b275d7d8f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9e9a5ae2ac38dc25cb071017b"`);
        await queryRunner.query(`DROP TABLE "casos"`);
    }

}
