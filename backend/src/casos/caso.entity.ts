import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Canal, EstadoCaso, PrioridadCaso } from './caso.model';

/**
 * Tabla de casos. Modelo multitenant "pooled": una sola tabla para todos los
 * municipios, aislada por la columna `tenant`. Toda consulta filtra por tenant
 * (ver CasosService); el índice (tenant, estado) soporta la bandeja.
 */
@Entity({ name: 'casos' })
@Index(['tenant', 'estado'])
// Índice parcial: la referencia es única dentro del secad, pero solo aplica a
// los casos importados (el resto la deja nula).
@Index(['tenant', 'referenciaExterna'], { unique: true, where: '"referenciaExterna" IS NOT NULL' })
export class CasoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'varchar', length: 20 })
  canal!: Canal;

  @Column({ type: 'varchar', length: 160 })
  titulo!: string;

  @Column({ type: 'text', default: '' })
  descripcion!: string;

  @Column({ type: 'varchar', length: 120 })
  ciudadano!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  telefono?: string | null;

  @Column({ type: 'varchar', length: 80, default: 'Central' })
  agencia!: string;

  /** Ubicación del incidente (para asignación de recursos por cercanía). */
  @Column({ type: 'double precision', nullable: true })
  lat?: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng?: number | null;

  /** Entidad externa que radicó el caso por la API entrante (si aplica). */
  @Column({ type: 'uuid', nullable: true })
  entidadId?: string | null;

  // --- Tipificación (código de caso) -----------------------------------------

  /**
   * Identificador del caso en el sistema de origen (número de llamada, radicado…).
   * Solo lo traen los casos importados y es lo que hace repetible la carga: una
   * segunda pasada del mismo archivo no vuelve a insertarlos.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  referenciaExterna?: string | null;

  /** Código de caso digitado en recepción (codigos_caso.codigo). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  codigoCaso?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'media' })
  prioridad!: PrioridadCaso;

  // --- Datos de quien reporta -------------------------------------------------

  /** Dirección del llamante, que no siempre coincide con la del caso. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  direccionLlamante?: string | null;

  // --- Ubicación del caso -----------------------------------------------------

  @Column({ type: 'varchar', length: 120, nullable: true })
  ciudad?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  barrio?: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  direccion?: string | null;

  // --- Atención ---------------------------------------------------------------

  /** Agencia desde la que se recepcionó (la del funcionario que lo registra). */
  @Column({ type: 'uuid', nullable: true })
  agenciaOrigenId?: string | null;

  /** Agencia que debe atenderlo (la que elige el operador). */
  @Column({ type: 'uuid', nullable: true })
  agenciaResponsableId?: string | null;

  /** Canales de atención a los que se envió (canales.id). */
  @Column({ type: 'simple-array', nullable: true })
  canales?: string[] | null;

  @Column({ type: 'varchar', length: 20, default: 'nuevo' })
  estado!: EstadoCaso;

  // --- Reapertura ------------------------------------------------------------

  /**
   * Un caso cerrado solo lo reabre quien tenga esa autorización. Quien lo cerró
   * deja aquí su solicitud para que un supervisor la resuelva.
   */
  @Column({ type: 'boolean', default: false })
  reaperturaSolicitada!: boolean;

  @Column({ type: 'text', nullable: true })
  reaperturaMotivo?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  reaperturaSolicitadaPor?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reaperturaSolicitadaEn?: Date | null;

  @Column({ type: 'varchar', length: 120 })
  creadoPor!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
