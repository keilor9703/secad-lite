import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Naturaleza de la agencia; define el ícono y agrupa en los tableros. */
export type TipoAgencia = 'policia' | 'bomberos' | 'salud' | 'transito' | 'gestion_riesgo' | 'otra';

export const TIPOS_AGENCIA: TipoAgencia[] = [
  'policia', 'bomberos', 'salud', 'transito', 'gestion_riesgo', 'otra',
];

/**
 * Agencia (o entidad) que atiende casos dentro de un secad: policía, bomberos,
 * salud, tránsito… Un funcionario pertenece a una, y todo caso tiene una agencia
 * de origen (la de quien lo recibe) y una responsable (la que debe atenderlo).
 */
@Entity({ name: 'agencias' })
@Index(['tenant', 'codigo'], { unique: true })
export class AgenciaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Código corto propio del secad (POLICIA, BOMB…). */
  @Column({ type: 'varchar', length: 32 })
  codigo!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 20, default: 'otra' })
  tipo!: TipoAgencia;

  @Column({ type: 'varchar', length: 40, nullable: true })
  telefono?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
