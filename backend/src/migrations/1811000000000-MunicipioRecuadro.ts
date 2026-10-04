import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El RECUADRO del municipio, no solo su centro.
 *
 * El buscador de direcciones acotaba las sugerencias con un círculo de 30 km
 * alrededor del centroide. Para Itagüí —17 km²— ese círculo cubre todo el Valle
 * de Aburrá y parte de más allá: «Calle 53» seguía trayendo resultados de otros
 * municipios, y el operador no tenía forma de notarlo. Y era un SESGO, no un
 * límite: Google podía devolver igual una dirección de Barranquilla si le
 * parecía más relevante.
 *
 * Con la extensión real se puede restringir de verdad, y además verificar que
 * el punto que devuelve el geocodificador cae donde debe. En un CAD eso no es
 * un lujo: un punto en el municipio equivocado es una patrulla en otra ciudad.
 */
export class MunicipioRecuadro1811000000000 implements MigrationInterface {
  name = 'MunicipioRecuadro1811000000000';

  async up(runner: QueryRunner): Promise<void> {
    for (const col of ['latSur', 'latNorte', 'lngOeste', 'lngEste']) {
      await runner.query(`ALTER TABLE geo_municipios ADD COLUMN IF NOT EXISTS "${col}" double precision`);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const col of ['latSur', 'latNorte', 'lngOeste', 'lngEste']) {
      await runner.query(`ALTER TABLE geo_municipios DROP COLUMN IF EXISTS "${col}"`);
    }
  }
}
