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

  /** WhatsApp Cloud API: phone_number_id (enruta los mensajes entrantes al tenant). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  waPhoneNumberId?: string | null;

  /** WhatsApp Cloud API: token de acceso para enviar respuestas (secreto). */
  @Column({ type: 'varchar', length: 400, nullable: true })
  waAccessToken?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
