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

  /**
   * Allowlist de IP/CIDR (p. ej. "203.0.113.4", "203.0.113.0/24") desde donde
   * se acepta la key de esta entidad. NULL/vacío = sin restricción — así
   * quedan las entidades existentes y las que llaman desde IP dinámica.
   */
  @Column({ type: 'simple-array', nullable: true })
  ipsPermitidas?: string[] | null;

  /** Última vez que la key de esta entidad se usó con éxito (radicar o consultar). */
  @Column({ type: 'timestamptz', nullable: true })
  ultimoUso?: Date | null;

  /** IP de esa última llamada exitosa. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ultimaIp?: string | null;

  /**
   * Últimas IPs distintas vistas con esta key (tope acotado, ver
   * MAX_IPS_VISTAS en IntegracionService) — no es un historial completo, es
   * una señal: si aparecen varias, la key se está usando desde más de un
   * origen de lo esperado (posible reparto entre apps o entre empresas).
   */
  @Column({ type: 'simple-array', nullable: true })
  ipsVistas?: string[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
