import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Capa de archivos: adjuntos de caso y grabaciones de videollamada.
 *
 * El contenido va en `archivos_chunks`, una fila por trozo, y no en disco:
 * FALCON CAD no guarda estado propio y corre replicado, así que los trozos de
 * una misma grabación pueden llegar a réplicas distintas. En la base, cualquier
 * réplica recibe cualquier trozo y lo subido queda a salvo desde el primero.
 *
 * Las dos tablas llevan RLS por tenant como el resto de las protegidas.
 */
export class Archivos1803000000000 implements MigrationInterface {
  name = 'Archivos1803000000000';

  async up(runner: QueryRunner): Promise<void> {
    // gen_random_uuid() vive aquí; en PostgreSQL 13+ ya es nativa, pero la
    // extensión no molesta y cubre despliegues sobre versiones anteriores.
    await runner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS archivos (
        id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant           varchar(64)  NOT NULL,
        "casoId"         uuid         NOT NULL,
        nombre           varchar(200) NOT NULL,
        "tipoMime"       varchar(120) NOT NULL,
        bytes            bigint       NOT NULL DEFAULT 0,
        estado           varchar(12)  NOT NULL DEFAULT 'EN_CURSO',
        origen           varchar(12)  NOT NULL DEFAULT 'ADJUNTO',
        usuario          varchar(120) NOT NULL,
        descripcion      varchar(300),
        "videoSesionId"  uuid,
        "creadoEn"       timestamptz  NOT NULL DEFAULT now(),
        "completadoEn"   timestamptz,
        "ultimoChunkEn"  timestamptz
      )
    `);

    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_archivos_caso"
        ON archivos (tenant, "casoId", "creadoEn" DESC)
    `);
    // El barrido de subidas abandonadas busca por estado.
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_archivos_estado"
        ON archivos (tenant, estado)
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS archivos_chunks (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant       varchar(64) NOT NULL,
        "archivoId"  uuid        NOT NULL REFERENCES archivos(id) ON DELETE CASCADE,
        indice       int         NOT NULL,
        datos        bytea       NOT NULL,
        bytes        int         NOT NULL,
        "creadoEn"   timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ÚNICO a propósito: es lo que hace idempotente reintentar un trozo. Sin
    // esto, una grabación sobre una red mala se duplicaría sola.
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_archivos_chunks_orden"
        ON archivos_chunks (tenant, "archivoId", indice)
    `);

    for (const tabla of ['archivos', 'archivos_chunks']) {
      await runner.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY`);
      await runner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${tabla};
        CREATE POLICY tenant_isolation ON ${tabla}
          USING (tenant = current_setting('app.tenant', true))
          WITH CHECK (tenant = current_setting('app.tenant', true));
      `);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE IF EXISTS archivos_chunks`);
    await runner.query(`DROP TABLE IF EXISTS archivos`);
  }
}
