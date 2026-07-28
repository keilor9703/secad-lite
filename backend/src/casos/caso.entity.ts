import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Canal, EstadoCaso } from './caso.model';

/**
 * Tabla de casos. Modelo multitenant "pooled": una sola tabla para todos los
 * municipios, aislada por la columna `tenant`. Toda consulta filtra por tenant
 * (ver CasosService); el índice (tenant, estado) soporta la bandeja.
 */
@Entity({ name: 'casos' })
@Index(['tenant', 'estado'])
export class CasoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'varchar', length: 20 })
  canal!: Canal;

  @Column({ type: 'varchar', length: 160 })
  titulo!: string;

  @Column({ type: 'text', default: '' })
  descripcion!: string;

  @Column({ type: 'varchar', length: 120 })
  ciudadano!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  telefono?: string | null;

  @Column({ type: 'varchar', length: 80, default: 'Central' })
  agencia!: string;

  @Column({ type: 'varchar', length: 20, default: 'nuevo' })
  estado!: EstadoCaso;

  @Column({ type: 'varchar', length: 120 })
  creadoPor!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
