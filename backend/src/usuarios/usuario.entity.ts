import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Rol del usuario. `superadmin` es global (gestiona secads y todos los usuarios);
 * el resto opera dentro de su secad. `ciudadano` es autoservicio para el chat.
 */
export type Rol = 'superadmin' | 'admin' | 'supervisor' | 'operador' | 'ciudadano';

export const ROLES: Rol[] = ['superadmin', 'admin', 'supervisor', 'operador', 'ciudadano'];
/** Roles que un admin de secad puede asignar (nunca superadmin). */
export const ROLES_ASIGNABLES: Rol[] = ['admin', 'supervisor', 'operador'];

/**
 * Usuario del sistema. El `username` es único a nivel global (el secad se deduce
 * del usuario al iniciar sesión). Cada usuario está asociado a un secad por
 * `tenant` (código del secad); el superadmin no tiene secad (tenant nulo).
 * La contraseña se guarda hasheada con bcrypt, nunca en claro.
 */
@Entity({ name: 'usuarios' })
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  username!: string;

  /** Código del secad al que pertenece. Nulo solo para el superadmin. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tenant?: string | null;

  @Column({ type: 'varchar', length: 200 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Column({ type: 'varchar', length: 20, default: 'operador' })
  rol!: Rol;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
