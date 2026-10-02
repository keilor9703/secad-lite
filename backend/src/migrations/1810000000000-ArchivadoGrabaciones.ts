import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archivado de grabaciones: sacar el video de la base SIN perderlo.
 *
 * Las grabaciones viven en `archivos_chunks` y la política es que ningún dato se
 * borra nunca. Las dos cosas juntas no caben en un disco de 200 GB, así que el
 * video tiene que salir del servidor y seguir existiendo en otra parte.
 *
 * Esta migración agrega lo que hace falta para que una grabación archivada siga
 * siendo una grabación y no un hueco:
 *
 *   archivadoEn    cuándo salió de la base.
 *   objetoRemoto   dónde está exactamente, en el almacenamiento de objetos.
 *   sha256         el hash del contenido original, calculado antes de liberar
 *                  los bytes. Es lo que permite, años después, demostrar que lo
 *                  que se descarga es byte a byte lo que se grabó. Sin él,
 *                  "está archivada" sería una afirmación sin respaldo.
 *
 * La fila de `archivos` NO se borra: el caso conserva la constancia de que la
 * grabación existió, de quién la hizo y cuánto pesaba. Lo único que se libera
 * son los bytes.
 */
export class ArchivadoGrabaciones1810000000000 implements MigrationInterface {
  name = 'ArchivadoGrabaciones1810000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE archivos ADD COLUMN IF NOT EXISTS "archivadoEn" timestamptz`);
    await runner.query(`ALTER TABLE archivos ADD COLUMN IF NOT EXISTS "objetoRemoto" varchar(300)`);
    await runner.query(`ALTER TABLE archivos ADD COLUMN IF NOT EXISTS sha256 char(64)`);

    // Índice parcial: el barrido nocturno busca grabaciones viejas todavía sin
    // archivar. Esa condición deja fuera casi toda la tabla, así que el índice
    // que importa es el que solo indexa a los candidatos —y se vacía solo a
    // medida que se archivan—.
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_archivos_por_archivar"
        ON archivos (tenant, "creadoEn")
        WHERE origen = 'GRABACION' AND "archivadoEn" IS NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX IF EXISTS "IDX_archivos_por_archivar"`);
    for (const col of ['archivadoEn', 'objetoRemoto', 'sha256']) {
      await runner.query(`ALTER TABLE archivos DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
