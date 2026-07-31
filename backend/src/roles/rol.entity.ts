import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Rol a medida de un tenant: un nombre + un conjunto de permisos del catálogo.
 * Los roles del sistema (admin/supervisor/operador) se siembran por tenant y no
 * se pueden borrar. El `codigo` es el identificador que guarda el usuario.
 */
@Entity({ name: 'roles' })
@Index(['tenant', 'codigo'], { unique: true })
export class RolEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Identificador estable del rol dentro del tenant (slug). */
  @Column({ type: 'varchar', length: 40 })
  codigo!: string;

  @Column({ type: 'varchar', length: 80 })
  nombre!: string;

  /** Permisos otorgados (claves del catálogo). */
  @Column({ type: 'simple-array', nullable: true })
  permisos!: string[];

  /** Rol de sistema (sembrado): editable en permisos, pero no se puede eliminar. */
  @Column({ type: 'boolean', default: false })
  esSistema!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
