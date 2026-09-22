import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Chat interno entre operadores y despachadores, anclado a un caso — nunca
 * suelto entre usuarios sin motivo. El caso es la única razón para que dos
 * funcionarios intercambien mensajes aquí, y por eso este mensaje no existe
 * sin uno (a diferencia de `MensajeChatEntity`, que es la conversación con el
 * CIUDADANO por WhatsApp; este es entre funcionarios, y necesita saber
 * exactamente quién escribió cada mensaje, no solo "un operador").
 */
@Entity({ name: 'casos_chat_interno' })
@Index(['tenant', 'casoId', 'creadoEn'])
export class MensajeChatInternoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  casoId!: string;

  /** Username de quien escribió (Actor.sub / JwtPayload.sub). */
  @Column({ type: 'varchar', length: 120 })
  autorId!: string;

  /** Nombre para mostrar, desnormalizado igual que en MensajeChatEntity. */
  @Column({ type: 'varchar', length: 120 })
  autorNombre!: string;

  @Column({ type: 'text' })
  texto!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
