import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Quién envía el mensaje de chat. */
export type AutorTipo = 'ciudadano' | 'operador';

/**
 * Mensaje de un chat asociado a un caso. Persistido para tener historial al
 * reconectar. Aislado por tenant e indexado por caso.
 */
@Entity({ name: 'casos_mensajes' })
@Index(['tenant', 'casoId', 'creadoEn'])
@Index(['tenant', 'waMessageId'], { unique: true, where: '"waMessageId" IS NOT NULL' })
export class MensajeChatEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  casoId!: string;

  @Column({ type: 'varchar', length: 20 })
  autorTipo!: AutorTipo;

  @Column({ type: 'varchar', length: 120 })
  autorNombre!: string;

  @Column({ type: 'text' })
  texto!: string;

  /**
   * Id del mensaje en WhatsApp (wamid), solo para los que entran por ese
   * canal. Meta reenvía los webhooks que no confirma a tiempo: con esta
   * marca (única por tenant, ver el índice de la clase), un reintento no
   * vuelve a insertar el mismo mensaje.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  waMessageId?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
