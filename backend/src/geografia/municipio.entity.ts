import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Municipio de Colombia (DIVIPOLA/DANE). Catálogo de referencia compartido
 * por toda la plataforma — ver `DepartamentoEntity`.
 *
 * `subregion` solo está poblada para Antioquia (sus 9 subregiones oficiales);
 * el resto de departamentos no tiene una subdivisión estandarizada a nivel
 * nacional con una única fuente autoritativa, así que queda NULL — un campo
 * libre en el tenant, no este catálogo, cubre ese caso si hace falta.
 */
@Entity({ name: 'geo_municipios' })
@Index(['departamentoCodigo'])
export class MunicipioEntity {
  /** Código DANE de 5 dígitos (2 del departamento + 3 del municipio). */
  @PrimaryColumn({ type: 'varchar', length: 5 })
  codigoDane!: string;

  @Column({ type: 'varchar', length: 2 })
  departamentoCodigo!: string;

  @Column({ type: 'varchar', length: 80 })
  nombre!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  subregion?: string | null;

  /** Centroide aproximado, para poder centrar un mapa sin geocodificar en vivo. */
  @Column({ type: 'double precision', nullable: true })
  lat?: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng?: number | null;

  /**
   * Extensión real del municipio, para ACOTAR la búsqueda de direcciones en vez
   * de solo sesgarla. Un círculo alrededor del centroide no sirve: el de 30 km
   * que se usaba antes cubría, para Itagüí, todo el Valle de Aburrá.
   */
  @Column({ type: 'double precision', nullable: true })
  latSur?: number | null;

  @Column({ type: 'double precision', nullable: true })
  latNorte?: number | null;

  @Column({ type: 'double precision', nullable: true })
  lngOeste?: number | null;

  @Column({ type: 'double precision', nullable: true })
  lngEste?: number | null;
}
