import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Entidad externa autorizada a radicar casos por la API entrante (bomberos,
 * salud, empresas de alarmas, apps municipales...). Cada una tiene su propia
 * API key (revocable/rotable) y pertenece a un tenant.
 */
@Entity({ name: 'entidades' })
@Index(['tenant', 'nombre'], { unique: true })
export class EntidadEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  /**
   * A quién se envían los casos que esta entidad radica: agencia responsable
   * del catálogo y sus canales de atención. Sin esto, un caso radicado no
   * llega a ninguna bandeja de despacho — solo lo ve un supervisor.
   */
  @Column({ type: 'uuid', nullable: true })
  agenciaResponsableId?: string | null;

  @Column({ type: 'simple-array', nullable: true })
  canales?: string[] | null;

  /** Nombre de la agencia, denormalizado para listar sin reconsultar el catálogo. */
  @Column({ type: 'varchar', length: 80, default: 'Central' })
  agencia!: string;

  /** Clave de la API entrante (header x-api-key). Secreta y rotable. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  apiKey!: string;

  @Column({ type: 'boolean', default: true })
  activa!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
