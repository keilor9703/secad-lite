import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NUESTRA PLANTA TELEFÓNICA, POR MUNICIPIO: `planta_asterisk`, `pbx_troncal`
 * y `pbx_numero`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTAS TRES TABLAS Y NO MÁS COLUMNAS EN `config_pbx`
 *
 * `config_pbx` responde «cómo le habla FALCON a la planta de esta instancia»,
 * y eso vale igual para una planta ajena (YACO, Zadarma) que para una nuestra.
 * Lo que aquí nace es otra pregunta: «qué infraestructura le provisionamos
 * nosotros a este municipio». Son dos cosas distintas y se editan en momentos
 * distintos —una al vender, la otra al montar el servidor—, y mezclarlas
 * dejaría una tabla donde la mitad de las columnas está vacía según el caso.
 *
 * La regla que evita las dos verdades: **la planta escribe su `config_pbx`**
 * al provisionarse. El dominio y la dirección WSS no se copian a mano de una
 * pantalla a la otra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE LA BASE GARANTIZA Y EL CÓDIGO NO PUEDE
 *
 * El reparto de puertos lo decide una función pura y probada
 * (`asignador-puertos.ts`), pero una función no protege de dos
 * provisionamientos simultáneos ni de un UPDATE a mano. Así que aquí van los
 * respaldos que solo la base puede dar:
 *
 *  1. `UNIQUE (servidor, "puertoSip")` y `UNIQUE (servidor, "puertoHttp")` —
 *     dos plantas con el mismo puerto en el mismo servidor: el segundo
 *     contenedor no arranca. Son puertos del host porque el contenedor va en
 *     la red del host (ver `asignador-puertos.ts`).
 *  2. Una **restricción de exclusión** sobre el rango RTP: dos tajadas que se
 *     CRUCEN en el mismo servidor quedan prohibidas por la base, no por una
 *     validación. Es el fallo más caro de todos —no impide arrancar, deja
 *     audio de un municipio entrando por el puerto de otro— y es justo el que
 *     un `UNIQUE` no sabe expresar. Necesita `btree_gist`; si el rol no puede
 *     crear extensiones, se degrada a un único sobre el inicio del rango y se
 *     avisa, porque es mejor eso que abortar el despliegue.
 *  3. `UNIQUE (usuarios.tenant, extension)` — ya lo valida
 *     `UsuariosService.resolverExtension`, pero bajo dos altas simultáneas
 *     dos funcionarios pueden quedar con la misma extensión, y entonces la
 *     central entrega la llamada a cualquiera de los dos.
 *  4. En `pbx_numero`, un único PARCIAL: un DID es único en el mundo, un
 *     número corto no (el 123 existe en todos los municipios). Ver la
 *     entidad.
 *
 * Si (3) encuentra extensiones ya repetidas, la migración se detiene y las
 * nombra. No las arregla sola a propósito: quitarle la extensión a un
 * funcionario cambia a quién le timbra el teléfono, y esa no es una decisión
 * que deba tomar un despliegue.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIN RLS, como `config_pbx`: no hay datos de casos ni de ciudadanos, solo
 * configuración que toca el superadmin. El aislamiento lo da la columna
 * `tenant` y el hecho de que nada de esto se expone al navegador.
 */
export class PlantaPropia1818000000000 implements MigrationInterface {
  name = 'PlantaPropia1818000000000';

  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE IF NOT EXISTS planta_asterisk (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant          varchar(64) NOT NULL UNIQUE,
        servidor        varchar(180) NOT NULL,
        "ipPublica"     varchar(64),
        "dominioSip"    varchar(180) NOT NULL UNIQUE,
        "puertoSip"     int NOT NULL,
        "rtpDesde"      int NOT NULL,
        "rtpHasta"      int NOT NULL,
        "puertoHttp"    int NOT NULL,
        estado          varchar(16) NOT NULL DEFAULT 'borrador',
        notas           text,
        "actualizadoPor" varchar(120),
        "creadoEn"      timestamptz NOT NULL DEFAULT now(),
        "actualizadoEn" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT planta_asterisk_rtp_coherente CHECK ("rtpHasta" >= "rtpDesde")
      )
    `);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_planta_asterisk_servidor ON planta_asterisk (servidor)',
    );
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_planta_asterisk_servidor_sip
        ON planta_asterisk (servidor, "puertoSip")
    `);
    // El HTTP también es un puerto del host: el contenedor comparte su red.
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_planta_asterisk_servidor_http
        ON planta_asterisk (servidor, "puertoHttp")
    `);

    // El cruce de rangos RTP, prohibido por la base. Dentro de un bloque con
    // EXCEPTION porque un CREATE EXTENSION sin permiso abortaría la
    // transacción entera de la migración (ver la migración Init).
    await runner.query(`
      DO $$
      BEGIN
        BEGIN
          CREATE EXTENSION IF NOT EXISTS btree_gist;
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        BEGIN
          ALTER TABLE planta_asterisk ADD CONSTRAINT planta_asterisk_rtp_sin_cruce
            EXCLUDE USING gist (
              servidor WITH =,
              int4range("rtpDesde", "rtpHasta", '[]') WITH &&
            );
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN OTHERS THEN
            EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_planta_asterisk_rtp '
                 || 'ON planta_asterisk (servidor, "rtpDesde")';
            RAISE WARNING 'Sin btree_gist no se pudo prohibir el CRUCE de rangos RTP; '
              'queda solo el único sobre el inicio del rango. El reparto de puertos '
              'sigue validado en el servicio.';
        END;
      END $$;
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS pbx_troncal (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant          varchar(64) NOT NULL,
        nombre          varchar(80) NOT NULL,
        proveedor       varchar(32) NOT NULL,
        servidor        varchar(180) NOT NULL,
        puerto          int NOT NULL DEFAULT 5060,
        autenticacion   varchar(16) NOT NULL DEFAULT 'ip',
        usuario         varchar(120),
        clave           varchar(500),
        redes           text,
        canales         int NOT NULL DEFAULT 10,
        prioridad       int NOT NULL DEFAULT 1,
        activa          boolean NOT NULL DEFAULT true,
        "actualizadoPor" varchar(120),
        "creadoEn"      timestamptz NOT NULL DEFAULT now(),
        "actualizadoEn" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_pbx_troncal_tenant ON pbx_troncal (tenant)',
    );
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pbx_troncal_tenant_nombre
        ON pbx_troncal (tenant, nombre)
    `);

    await runner.query(`
      CREATE TABLE IF NOT EXISTS pbx_numero (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant          varchar(64) NOT NULL,
        numero          varchar(24) NOT NULL,
        tipo            varchar(16) NOT NULL DEFAULT 'did',
        "troncalId"     uuid REFERENCES pbx_troncal(id) ON DELETE SET NULL,
        destino         varchar(64) NOT NULL DEFAULT 'cola',
        descripcion     varchar(120),
        activo          boolean NOT NULL DEFAULT true,
        "actualizadoPor" varchar(120),
        "creadoEn"      timestamptz NOT NULL DEFAULT now(),
        "actualizadoEn" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_pbx_numero_tenant ON pbx_numero (tenant)',
    );
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pbx_numero_tenant_numero
        ON pbx_numero (tenant, numero)
    `);
    // Un DID es único en el planeta; un número corto, no.
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pbx_numero_did
        ON pbx_numero (numero) WHERE tipo = 'did'
    `);

    // ── El respaldo de la unicidad de extensiones ───────────────────────────
    await runner.query(`
      DO $$
      DECLARE repetidas text;
      BEGIN
        SELECT string_agg(format('%s → %s', tenant, extension), ', ')
          INTO repetidas
          FROM (
            SELECT tenant, extension
              FROM usuarios
             WHERE extension IS NOT NULL AND extension <> ''
             GROUP BY tenant, extension
            HAVING count(*) > 1
          ) x;
        IF repetidas IS NOT NULL THEN
          RAISE EXCEPTION 'Hay extensiones repetidas dentro de una misma instancia: %. '
            'Deje una sola por extensión en Administración → Funcionarios y repita el '
            'despliegue; no se corrige automáticamente porque cambia a quién le timbra.',
            repetidas;
        END IF;
      END $$;
    `);
    await runner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_tenant_extension
        ON usuarios (tenant, extension)
        WHERE extension IS NOT NULL AND extension <> ''
    `);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX IF EXISTS ux_usuarios_tenant_extension');
    await runner.query('DROP TABLE IF EXISTS pbx_numero');
    await runner.query('DROP TABLE IF EXISTS pbx_troncal');
    await runner.query('DROP TABLE IF EXISTS planta_asterisk');
  }
}
