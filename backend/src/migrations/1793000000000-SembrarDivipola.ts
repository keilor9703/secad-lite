import { MigrationInterface, QueryRunner } from 'typeorm';
// require(), no `import … from`: bajo ts-node (que corre esta migración tal
// cual en desarrollo) el interop de imports por defecto para JSON no
// siempre resuelve igual que en el build compilado con tsc — require() es
// exactamente el mismo mecanismo de Node en los dos casos.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const divipola = require('../geografia/divipola-colombia.json');

/**
 * Catálogo de referencia de Colombia (departamentos y municipios, DIVIPOLA/
 * DANE) — el insumo para los selects encadenados del alta de tenants y del
 * municipio del caso en Recepción. A diferencia de los catálogos operativos
 * de cada secad (agencias, canales…), este es el mismo para toda la
 * plataforma y se siembra una sola vez aquí, no en el primer request de cada
 * tenant.
 *
 * Fuente: DANE, vía el dataset compilado en
 * https://github.com/RafaelRamosR/dane-codigos-municipios (1123 municipios,
 * 33 departamentos incluida Bogotá D.C.). Las subregiones solo están
 * pobladas para Antioquia (sus 9 subregiones oficiales) — el resto de
 * departamentos no tiene una división de esa clase con una única fuente
 * nacional autoritativa.
 */
export class SembrarDivipola1793000000000 implements MigrationInterface {
  name = 'SembrarDivipola1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "geo_departamentos" (
        "codigoDane" character varying(2) NOT NULL,
        "nombre" character varying(80) NOT NULL,
        CONSTRAINT "PK_geo_departamentos" PRIMARY KEY ("codigoDane")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "geo_municipios" (
        "codigoDane" character varying(5) NOT NULL,
        "departamentoCodigo" character varying(2) NOT NULL,
        "nombre" character varying(80) NOT NULL,
        "subregion" character varying(40),
        "lat" double precision,
        "lng" double precision,
        CONSTRAINT "PK_geo_municipios" PRIMARY KEY ("codigoDane")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_geo_municipios_departamento"
        ON "geo_municipios" ("departamentoCodigo")
    `);

    const { departamentos, municipios } = divipola as {
      departamentos: Array<{ codigoDane: string; nombre: string }>;
      municipios: Array<{ codigoDane: string; departamentoCodigo: string; nombre: string; subregion: string | null }>;
    };

    for (const chunk of chunks(departamentos, 300)) {
      const { sql, params } = insertoMasivo(
        'geo_departamentos', ['codigoDane', 'nombre'],
        chunk.map((d) => [d.codigoDane, d.nombre]),
      );
      await queryRunner.query(sql, params);
    }

    for (const chunk of chunks(municipios, 300)) {
      const { sql, params } = insertoMasivo(
        'geo_municipios', ['codigoDane', 'departamentoCodigo', 'nombre', 'subregion'],
        chunk.map((m) => [m.codigoDane, m.departamentoCodigo, m.nombre, m.subregion]),
      );
      await queryRunner.query(sql, params);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "geo_municipios"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "geo_departamentos"`);
  }
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** INSERT ... ON CONFLICT DO NOTHING de varias filas en una sola sentencia. */
function insertoMasivo(tabla: string, columnas: string[], filas: unknown[][]): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const valores = filas
    .map((fila) => {
      const marcadores = fila.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${marcadores.join(', ')})`;
    })
    .join(', ');
  const cols = columnas.map((c) => `"${c}"`).join(', ');
  const sql = `INSERT INTO "${tabla}" (${cols}) VALUES ${valores} ON CONFLICT DO NOTHING`;
  return { sql, params };
}
