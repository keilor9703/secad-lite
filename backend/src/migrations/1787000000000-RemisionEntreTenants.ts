import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remisión de un caso a otra jurisdicción (otro tenant): un caso recepcionado
 * en un municipio puede en realidad corresponder a otro. Como el modelo es
 * pooled y cada `caso` tiene ids (agencia, canales) que solo tienen sentido
 * dentro de su propio tenant, no se "mueve" la fila: el caso original queda
 * `derivado` en su tenant y se crea uno nuevo en el tenant destino, enlazados
 * por estas columnas para la trazabilidad en ambos sentidos.
 */
export class RemisionEntreTenants1787000000000 implements MigrationInterface {
  name = 'RemisionEntreTenants1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "remitidoDeTenant" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "remitidoDeCasoId" uuid`);
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "remitidoATenant" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "remitidoACasoId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "remitidoACasoId"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "remitidoATenant"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "remitidoDeCasoId"`);
    await queryRunner.query(`ALTER TABLE "casos" DROP COLUMN IF EXISTS "remitidoDeTenant"`);
  }
}
