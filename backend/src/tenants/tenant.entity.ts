import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un tenant: la instancia de un municipio/organización en el modelo
 * multi-inquilino. Cada usuario queda asociado a un tenant por su `codigo`.
 */
@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código corto y único del tenant (p. ej. "demo", "envigado"). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  codigo!: string;

  @Column({ type: 'varchar', length: 160 })
  nombre!: string;

  /**
   * Clave de API del tenant para integraciones entrantes (webhook de la planta
   * telefónica, API de terceros). Secreta; se puede rotar desde administración.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  apiKey?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
