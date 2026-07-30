import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Estado de una llamada entrante en la cola de la planta telefónica. */
export type EstadoLlamada = 'sonando' | 'atendida' | 'perdida' | 'finalizada';

export const ESTADOS_LLAMADA: EstadoLlamada[] = ['sonando', 'atendida', 'perdida', 'finalizada'];

/**
 * Llamada entrante recibida por webhook desde la planta telefónica (PBX) del
 * tenant. Alimenta la cola en vivo del operador (screen-pop): al atenderla se
 * crea o enlaza un caso. Aislada por tenant.
 */
@Entity({ name: 'llamadas' })
@Index(['tenant', 'estado'])
export class LlamadaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Identificador de la llamada en la PBX (para correlacionar eventos). */
  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  callId?: string | null;

  /** Número del llamante (caller id). */
  @Column({ type: 'varchar', length: 40 })
  numero!: string;

  /** Línea/DID marcada (opcional). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  numeroDestino?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'sonando' })
  estado!: EstadoLlamada;

  /** Caso creado/enlazado al atender la llamada. */
  @Column({ type: 'uuid', nullable: true })
  casoId?: string | null;

  /** Operador que atendió (sub del JWT). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  atendidaPor?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
