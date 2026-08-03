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

  /** Agencia por defecto de los casos que radica (p. ej. Bomberos). */
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
