import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un mensaje del chat de la videollamada.
 *
 * Existe porque el chat NO puede ir por un canal de datos punto a punto: así
 * los mensajes no tocarían el servidor y no quedaría ni rastro al cerrar el
 * caso. En una emergencia el chat es a menudo donde está lo crítico —«no puedo
 * hablar», una placa, una dirección— y puede ser material probatorio.
 */
@Entity({ name: 'video_chat_mensajes' })
@Index(['tenant', 'sesionId', 'creadoEn'])
export class VideoChatMensajeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  sesionId!: string;

  /** Se desnormaliza para poder listar el chat de un caso sin pasar por la sesión. */
  @Column({ type: 'uuid' })
  casoId!: string;

  /**
   * DESPACHADOR o CIUDADANO. NO lo dice el cliente: lo pone el servidor a
   * partir del rol con el que esa conexión entró a la sala.
   */
  @Column({ type: 'varchar', length: 12 })
  emisor!: 'DESPACHADOR' | 'CIUDADANO';

  @Column({ type: 'varchar', length: 2000 })
  texto!: string;

  /** Quién lo escribió, cuando fue el despachador. Null si fue el ciudadano. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  usuario?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
