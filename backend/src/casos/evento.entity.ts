import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Tipo de evento en la bitácora de un caso. */
export type TipoEvento = 'creacion' | 'estado' | 'derivacion' | 'nota' | 'despacho';

export const TIPOS_EVENTO: TipoEvento[] = ['creacion', 'estado', 'derivacion', 'nota', 'despacho'];

/**
 * Bitácora de auditoría de un caso: una fila por acción (creación, cambio de
 * estado, derivación, nota). Inmutable — solo se agrega. Aislada por tenant e
 * indexada por caso para reconstruir la línea de tiempo.
 */
@Entity({ name: 'casos_eventos' })
@Index(['tenant', 'casoId', 'creadoEn'])
export class EventoCasoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  casoId!: string;

  @Column({ type: 'varchar', length: 20 })
  tipo!: TipoEvento;

  @Column({ type: 'text' })
  descripcion!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  estadoAnterior?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  estadoNuevo?: string | null;

  @Column({ type: 'varchar', length: 120 })
  autor!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
