import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * En qué punto de la admisión está una conversación de WhatsApp.
 *
 * - `nueva`           — todavía no hay caso. Solo han llegado saludos.
 * - `esperando_tipo`  — hay caso, y se le preguntó al ciudadano de qué es.
 * - `esperando_lugar` — ya está tipificado, falta dónde ocurre.
 * - `cerrada`         — el bot terminó, o se calló porque entró un operador.
 */
export type EstadoAdmision = 'nueva' | 'esperando_tipo' | 'esperando_lugar' | 'cerrada';

/**
 * LA CONVERSACIÓN ANTES DE QUE SEA UN CASO.
 *
 * Hasta ahora todo mensaje de WhatsApp creaba o continuaba un caso, y eso
 * hace inviable abrir el canal: una línea de emergencias publicada recibe
 * «hola», stickers, números equivocados y gente probando si contesta un
 * robot. Cada uno de esos competía por atención con una emergencia real en
 * la bandeja de Recepción.
 *
 * Esta tabla es el paso previo: un mensaje entrante nace como CONVERSACIÓN,
 * y solo algunas se convierten en caso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA TABLA Y NO MEMORIA DEL PROCESO
 *
 * Porque el backend corre con tres réplicas detrás de un balanceador. Dos
 * mensajes seguidos del mismo ciudadano pueden caer en réplicas distintas, y
 * un estado en memoria haría que la segunda no supiera nada de la primera:
 * el bot volvería a saludar, o peor, no reconocería la respuesta al menú y
 * abriría un caso duplicado.
 */
@Entity({ name: 'whatsapp_conversaciones' })
@Index(['tenant', 'telefono'], { unique: true })
export class ConversacionWaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** El número del ciudadano, en dígitos, tal como lo manda el proveedor. */
  @Column({ type: 'varchar', length: 24 })
  telefono!: string;

  @Column({ type: 'varchar', length: 20, default: 'nueva' })
  estado!: EstadoAdmision;

  /** El caso que nació de esta conversación, si llegó a nacer. */
  @Column({ type: 'uuid', nullable: true })
  casoId?: string | null;

  /**
   * Cuántas veces le ha escrito el bot.
   *
   * Está para poder callarlo. Un bot que insiste en una línea de emergencias
   * es peor que uno que no pregunta: el ciudadano que está escondido o
   * herido no necesita un cuestionario, necesita que alguien lea lo que ya
   * escribió.
   */
  @Column({ type: 'int', default: 0 })
  mensajesDelBot!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
