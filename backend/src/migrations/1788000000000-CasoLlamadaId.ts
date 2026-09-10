import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enlace inverso caso → llamada: `llamadas.casoId` ya existe, pero mostrar
 * la llamada en cada fila de Consulta necesitaba ir y buscarla; con esta
 * columna denormalizada (la fija PbxService.vincular()) el listado de casos
 * la trae directo, sin join.
 */
export class CasoLlamadaId1788000000000 implements MigrationInterface {
  name = 'CasoLlamadaId1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "llamadaId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "llamadaId"`);
  }
}
