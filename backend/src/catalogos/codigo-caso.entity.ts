import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PrioridadCaso = 'alta' | 'media' | 'baja';
export const PRIORIDADES: PrioridadCaso[] = ['alta', 'media', 'baja'];

/**
 * Tipificación del caso (el "código de caso" del CAD): un código corto que el
 * operador digita y su descripción, con la prioridad y la agencia que
 * habitualmente lo atiende, para preseleccionarlas en recepción.
 */
@Entity({ name: 'codigos_caso' })
@Index(['tenant', 'codigo'], { unique: true })
export class CodigoCasoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'varchar', length: 16 })
  codigo!: string;

  @Column({ type: 'varchar', length: 160 })
  descripcion!: string;

  @Column({ type: 'varchar', length: 10, default: 'media' })
  prioridad!: PrioridadCaso;

  /** Agencia que suele atenderlo (agencias.id); solo es una sugerencia. */
  @Column({ type: 'uuid', nullable: true })
  agenciaSugeridaId?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
