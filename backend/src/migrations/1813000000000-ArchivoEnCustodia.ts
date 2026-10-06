import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El cuarto sitio donde puede estar una grabación: el archivo permanente fuera
 * de línea.
 *
 * La política es que NADA se borra nunca. Los bytes se mueven —base, bucket,
 * NAS— pero el caso siempre sabe qué grabación tuvo, con qué nombre y con qué
 * sha256. Sin este estado, el día que una grabación saliera del bucket el
 * operador se encontraría una descarga rota y ningún texto que lo explicara.
 *
 * Solo añade una fecha: el estado viaja en la columna `estado`, que ya es
 * varchar(12) y admite 'EN_CUSTODIA'.
 */
export class ArchivoEnCustodia1813000000000 implements MigrationInterface {
  name = 'ArchivoEnCustodia1813000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE archivos ADD COLUMN IF NOT EXISTS "enCustodiaDesde" timestamptz');
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE archivos DROP COLUMN IF EXISTS "enCustodiaDesde"');
  }
}
