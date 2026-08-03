import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Canal de atención: la cola de despacho dentro de una agencia (cuadrante,
 * CAI, máquina, ambulancia…). Un caso se envía a uno o varios canales, y cada
 * funcionario ve en su bandeja los canales que tiene asignados.
 *
 * Ojo: no confundir con el canal de ENTRADA del caso (llamada, chat,
 * integración), que es el medio por el que llegó y vive en `casos.canal`.
 */
@Entity({ name: 'canales' })
@Index(['tenant', 'agenciaId'])
@Index(['tenant', 'agenciaId', 'codigo'], { unique: true })
export class CanalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Agencia dueña del canal (agencias.id). */
  @Column({ type: 'uuid' })
  agenciaId!: string;

  /** Código corto dentro de la agencia (C1, CAI-CENTRO…). */
  @Column({ type: 'varchar', length: 32 })
  codigo!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
