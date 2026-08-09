import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitácora de administración: quién cambió qué en la configuración del
 * sistema. Los CASOS ya tenían su línea de tiempo; los cambios de usuarios,
 * roles, claves e integraciones no dejaban rastro — y son justamente los que
 * un auditor pregunta primero.
 */
@Entity({ name: 'admin_bitacora' })
@Index(['tenant', 'creadoEn'])
export class BitacoraAdminEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Instancia afectada; para acciones de plataforma, el código del tenant tocado. */
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Quién lo hizo (sub del JWT). */
  @Column({ type: 'varchar', length: 120 })
  autor!: string;

  /** Qué se hizo, en clave corta: usuario.crear, rol.permisos, pbx.rotar… */
  @Column({ type: 'varchar', length: 60 })
  accion!: string;

  /** Sobre qué y con qué resultado, en palabras. */
  @Column({ type: 'text' })
  detalle!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
