import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Rol del usuario dentro de la agencia. */
export type Rol = 'operador' | 'supervisor' | 'admin' | 'ciudadano';

export const ROLES: Rol[] = ['operador', 'supervisor', 'admin', 'ciudadano'];

/**
 * Usuario del sistema. Aislado por tenant; el par (tenant, username) es único.
 * La contraseña se guarda hasheada con bcrypt, nunca en claro.
 */
@Entity({ name: 'usuarios' })
@Index(['tenant', 'username'], { unique: true })
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'varchar', length: 120 })
  username!: string;

  @Column({ type: 'varchar', length: 200 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 20, default: 'operador' })
  rol!: Rol;

  @Column({ type: 'varchar', length: 20, default: 'institucional' })
  tipo!: 'institucional' | 'civil';

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
