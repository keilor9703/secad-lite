import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convierte la columna `canales` de `casos` de varchar CSV (simple-array de
 * TypeORM) a text[] nativo de PostgreSQL. Mantiene los datos existentes.
 * REVERSIBLE: el revert convierte de vuelta a varchar.
 */
export class ConvertirCanalesAArray1725300000000 implements MigrationInterface {
  name = 'ConvertirCanalesAArray1725300000000';

  async up(runner: QueryRunner): Promise<void> {
    // 1. Añadir columna temporal como text[]
    await runner.query(`ALTER TABLE casos ADD COLUMN canales_arr text[]`);
    // 2. Migrar datos: convertir CSV a array (filtrando vacíos)
    await runner.query(`
      UPDATE casos
      SET canales_arr = CASE
        WHEN canales IS NULL OR canales = '' THEN ARRAY[]::text[]
        ELSE string_to_array(canales, ',')
      END
    `);
    // 3. Eliminar columna antigua y renombrar la nueva
    await runner.query(`ALTER TABLE casos DROP COLUMN canales`);
    await runner.query(`ALTER TABLE casos RENAME COLUMN canales_arr TO canales`);
    // 4. Crear índice GIN para búsquedas eficientes por elemento
    await runner.query(`CREATE INDEX idx_casos_canales_gin ON casos USING GIN (canales)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS idx_casos_canales_gin`);
    await runner.query(`ALTER TABLE casos ADD COLUMN canales_csv varchar`);
    await runner.query(`UPDATE casos SET canales_csv = array_to_string(canales, ',')`);
    await runner.query(`ALTER TABLE casos DROP COLUMN canales`);
    await runner.query(`ALTER TABLE casos RENAME COLUMN canales_csv TO canales`);
  }
}
