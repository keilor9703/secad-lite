import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Quién envía el mensaje de chat. */
export type AutorTipo = 'ciudadano' | 'operador';

/**
 * Mensaje de un chat asociado a un caso. Persistido para tener historial al
 * reconectar. Aislado por tenant e indexado por caso.
 */
@Entity({ name: 'casos_mensajes' })
@Index(['tenant', 'casoId', 'creadoEn'])
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

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
