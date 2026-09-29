import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Videollamada con el ciudadano: la sesión y el chat.
 *
 * El video no pasa por el servidor —va punto a punto entre los dos
 * navegadores—, así que aquí solo queda lo que hay que saber del hecho: quién
 * la abrió, cuándo entró el ciudadano, desde qué IP, dónde estaba y cuándo
 * terminó.
 *
 * El chat SÍ se guarda: en una emergencia suele ser donde está lo crítico («no
 * puedo hablar», una placa, una dirección) y puede ser material probatorio.
 *
 * Las dos tablas llevan RLS por tenant, como el resto de las de operación.
 */
export class Videollamada1805000000000 implements MigrationInterface {
  name = 'Videollamada1805000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS video_sesiones (
        id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant                 varchar(64)  NOT NULL,
        "casoId"               uuid         NOT NULL,
        estado                 varchar(12)  NOT NULL DEFAULT 'PENDIENTE',
        "usuarioDespachador"   varchar(120) NOT NULL,
        "numeroTelefono"       varchar(30),
        "expiraEn"             timestamptz  NOT NULL,
        "conectadoEn"          timestamptz,
        "finalizadoEn"         timestamptz,
        "ipCiudadano"          varchar(45),
        "ultimaLat"            double precision,
        "ultimaLng"            double precision,
        "ultimaPrecision"      double precision,
        "ultimaUbicacionEn"    timestamptz,
        "archivoGrabacionId"   uuid,
        "creadoEn"             timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_video_sesiones_caso"
        ON video_sesiones (tenant, "casoId", "creadoEn" DESC)
    `);
    // La consulta «¿hay una llamada en curso para este caso?» corre cada vez
    // que se abre un caso en despacho.
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_video_sesiones_estado"
        ON video_sesiones (tenant, estado)
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS video_chat_mensajes (
        id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant      varchar(64)   NOT NULL,
        "sesionId"  uuid          NOT NULL REFERENCES video_sesiones(id) ON DELETE CASCADE,
        "casoId"    uuid          NOT NULL,
        emisor      varchar(12)   NOT NULL,
        texto       varchar(2000) NOT NULL,
        usuario     varchar(120),
        "creadoEn"  timestamptz   NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_video_chat_sesion"
        ON video_chat_mensajes (tenant, "sesionId", "creadoEn")
    `);

    for (const tabla of ['video_sesiones', 'video_chat_mensajes']) {
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
    await runner.query(`DROP TABLE IF EXISTS video_chat_mensajes`);
    await runner.query(`DROP TABLE IF EXISTS video_sesiones`);
  }
}
