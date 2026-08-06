import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referencia del caso en el sistema de origen. Solo la traen los casos
 * importados y es lo que hace repetible la carga masiva: el índice único
 * (parcial, porque el resto de casos la deja nula) impide duplicarlos.
 */
export class ReferenciaExterna1786050232000 implements MigrationInterface {
  name = 'ReferenciaExterna1786050232000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD "referenciaExterna" character varying(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_casos_tenant_referencia" ON "casos" ("tenant", "referenciaExterna") WHERE "referenciaExterna" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_casos_tenant_referencia"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN "referenciaExterna"`);
  }
}
