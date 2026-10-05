import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tirar la caché de geocodificación de municipios: puede estar envenenada.
 *
 * Hasta ahora el centro y el recuadro se resolvían pidiéndole a Nominatim
 * «<municipio>, <departamento>, Colombia» con `limit=1` y guardando lo primero
 * que llegara, sin comprobar que fuera un municipio. Para «Retiro, Antioquia»
 * devolvió un lugar de la zona de Urrao —a unos 130 km de El Retiro— y ese
 * rectángulo quedó guardado como la extensión del municipio. Con él, el mapa
 * se abría en Urrao, el buscador sesgaba hacia allá y la verificación
 * rechazaba toda dirección legítima de El Retiro.
 *
 * No hay forma de saber cuáles de las filas ya resueltas salieron bien, así
 * que se vacían todas: es una caché, se repuebla sola la primera vez que se
 * consulta cada municipio, ahora con los filtros de `elegirMunicipio`. El
 * catálogo en sí (código DANE, nombre, departamento, subregión) no se toca.
 */
export class MunicipioRecuadroConfiable1812000000000 implements MigrationInterface {
  name = 'MunicipioRecuadroConfiable1812000000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'UPDATE geo_municipios SET lat = NULL, lng = NULL, '
      + '"latSur" = NULL, "latNorte" = NULL, "lngOeste" = NULL, "lngEste" = NULL',
    );
  }

  async down(): Promise<void> {
    // Vaciar una caché no se deshace: los valores viejos eran justamente el
    // problema. Se repuebla consultando, que es lo que hace el servicio.
  }
}
