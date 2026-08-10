import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Tipo de recurso operativo. */
export type TipoRecurso = 'patrulla' | 'ambulancia' | 'maquina' | 'moto' | 'otro';

/** Estado operativo del recurso. */
export type EstadoRecurso = 'disponible' | 'asignado' | 'en_ruta' | 'en_sitio' | 'fuera_servicio';

export const TIPOS_RECURSO: TipoRecurso[] = ['patrulla', 'ambulancia', 'maquina', 'moto', 'otro'];
export const ESTADOS_RECURSO: EstadoRecurso[] = ['disponible', 'asignado', 'en_ruta', 'en_sitio', 'fuera_servicio'];

/**
 * Recurso operativo despachable (patrulla, ambulancia, máquina de bomberos…).
 * Pertenece a un tenant y a una agencia. Su `estado` refleja su disponibilidad
 * y, si está en atención, la fase de la asignación activa.
 */
@Entity({ name: 'recursos' })
@Index(['tenant', 'estado'])
@Index(['tenant', 'codigo'], { unique: true })
export class RecursoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Código operativo, único por tenant (p. ej. "P-01", "AMB-3"). */
  @Column({ type: 'varchar', length: 32 })
  codigo!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 20, default: 'patrulla' })
  tipo!: TipoRecurso;

  /**
   * Agencia dueña del recurso (agencias.id). Es la referencia real; el texto
   * de abajo se conserva denormalizado para los recursos anteriores al
   * catálogo y para no reconsultar en cada listado.
   */
  @Column({ type: 'uuid', nullable: true })
  agenciaId?: string | null;

  @Column({ type: 'varchar', length: 80, default: 'Central' })
  agencia!: string;

  @Column({ type: 'varchar', length: 20, default: 'disponible' })
  estado!: EstadoRecurso;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
