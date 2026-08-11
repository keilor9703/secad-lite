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

  /**
   * Extensión que reportó el webhook, cuando el ACD de la central ya decidió
   * a qué operador enrutar la llamada. Se conserva aunque no haya emparejado
   * con nadie (extensión mal configurada), para poder diagnosticarlo.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  extension?: string | null;

  /**
   * Username del funcionario a quien el ACD dirigió la llamada (resuelto por
   * la extensión). Nulo si la central no manda extensión o no hay match: en
   * ese caso la llamada se anuncia a todo el que esté atendiendo el tenant,
   * como antes de tener enrutamiento por extensión.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  destinatario?: string | null;

  @Column({ type: 'varchar', length: 20, default: 'sonando' })
  estado!: EstadoLlamada;

  /** Caso creado/enlazado al atender la llamada. */
  @Column({ type: 'uuid', nullable: true })
  casoId?: string | null;

  /** Operador que atendió (sub del JWT). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  atendidaPor?: string | null;

  /**
   * Momento en que pasó a 'atendida'. No basta con `actualizadoEn`: esa
   * columna se vuelve a pisar cuando la llamada luego pasa a 'finalizada'
   * (cuelga), y con eso se perdería el instante real de la respuesta —
   * es lo que mide el tiempo de respuesta del reporte.
   */
  @Column({ type: 'timestamptz', nullable: true })
  atendidaEn?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
