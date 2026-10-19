import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `archivos.llamadaId`: la grabación de una llamada, atada a su llamada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN ARCHIVO DEL CASO Y NO UNA URL
 *
 * `casos.urlGrabacion` ya existía y se queda como está: es para la
 * integración con una central ajena, que graba en SU almacenamiento y entrega
 * un enlace. No sirve para la planta propia, porque el archivo lo tiene
 * nuestro contenedor en un volumen al que nadie llega desde internet.
 *
 * La grabación de nuestra planta entra por donde ya entran los adjuntos y las
 * grabaciones de videollamada: `archivos`, con `origen = 'GRABACION'`. Eso no
 * es reutilizar por ahorrar, es reutilizar cuatro cosas que ya están
 * resueltas y que una URL no da:
 *
 *  1. **El permiso.** `casos.ver_grabaciones` ya decide quién puede oír una
 *     grabación, y el controlador de archivos ya lo aplica.
 *  2. **El archivado.** Las grabaciones viejas salen de la base al
 *     almacenamiento de objetos sin borrarse, y se siguen sirviendo igual.
 *  3. **La custodia y el hash.** El SHA-256 se calcula antes de liberar los
 *     bytes, así que años después se puede demostrar que lo que se oye es
 *     byte a byte lo que se grabó. En una línea de emergencias eso no es un
 *     lujo: es lo que sirve en un proceso.
 *  4. **El barrido de abandonados**, para una subida que se cortó a medias.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ÚNICO PARCIAL, Y POR QUÉ NO ES UN ÚNICO NORMAL
 *
 * Una llamada tiene UNA grabación, así que `(tenant, llamadaId)` es único
 * —eso hace idempotente el reintento de la planta, que es lo normal con una
 * red mala: si el primer intento sí llegó, el segundo no duplica—.
 *
 * Pero el único EXCLUYE los `FALLIDO`: una subida que se cortó a medias deja
 * una fila fallida, y si esa fila bloqueara el hueco, el reintento que sí
 * podría funcionar quedaría rechazado para siempre. Lo que no se puede
 * duplicar es una grabación buena, no el rastro de un intento.
 */
export class GrabacionDeLlamada1819000000000 implements MigrationInterface {
  name = 'GrabacionDeLlamada1819000000000';

  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE archivos ADD COLUMN IF NOT EXISTS "llamadaId" uuid',
    );
    await runner.query(`
      CREATE INDEX IF NOT EXISTS idx_archivos_tenant_llamada
        ON archivos (tenant, "llamadaId")
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_archivos_llamada
        ON archivos (tenant, "llamadaId")
        WHERE "llamadaId" IS NOT NULL AND estado <> 'FALLIDO'
    `);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS ux_archivos_llamada');
    await runner.query('DROP INDEX IF EXISTS idx_archivos_tenant_llamada');
    await runner.query(
      'ALTER TABLE archivos DROP COLUMN IF EXISTS "llamadaId"',
    );
  }
}
