import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Fase del despacho de un recurso hacia un caso. */
export type EstadoAsignacion = 'asignado' | 'en_ruta' | 'en_sitio' | 'finalizada' | 'cancelada';

export const ESTADOS_ASIGNACION: EstadoAsignacion[] = ['asignado', 'en_ruta', 'en_sitio', 'finalizada', 'cancelada'];
/** Estados en los que la asignación (y el recurso) siguen comprometidos. */
export const ESTADOS_ASIGNACION_ACTIVOS: EstadoAsignacion[] = ['asignado', 'en_ruta', 'en_sitio'];

/**
 * Despacho de un recurso a un caso. Registra el ciclo asignado → en ruta →
 * en sitio → finalizada (o cancelada). El código/nombre del recurso se
 * desnormaliza para listar sin join. Aislada por tenant e indexada por caso.
 */
@Entity({ name: 'asignaciones' })
@Index(['tenant', 'casoId'])
export class AsignacionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  casoId!: string;

  @Column({ type: 'uuid' })
  recursoId!: string;

  @Column({ type: 'varchar', length: 32 })
  recursoCodigo!: string;

  @Column({ type: 'varchar', length: 120 })
  recursoNombre!: string;

  @Column({ type: 'varchar', length: 20, default: 'asignado' })
  estado!: EstadoAsignacion;

  @Column({ type: 'varchar', length: 120 })
  asignadoPor!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  motivo?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
