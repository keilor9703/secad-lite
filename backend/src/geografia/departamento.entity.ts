import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Departamento de Colombia (división político-administrativa DIVIPOLA/DANE).
 * Catálogo de referencia, no tenant-scoped: es el mismo para toda la
 * plataforma. Se siembra una única vez por migración (ver `SembrarDivipola`),
 * no en el arranque de cada secad como los catálogos operativos.
 */
@Entity({ name: 'geo_departamentos' })
export class DepartamentoEntity {
  /** Código DANE de 2 dígitos (p. ej. "05" = Antioquia). */
  @PrimaryColumn({ type: 'varchar', length: 2 })
  codigoDane!: string;

  @Column({ type: 'varchar', length: 80 })
  nombre!: string;
}
