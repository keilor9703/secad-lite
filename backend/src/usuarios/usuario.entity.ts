import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Código de rol. Con el RBAC dinámico los roles viven en la tabla `roles` por
 * tenant; aquí solo queda el alias de tipo. 'superadmin' (global) y 'ciudadano'
 * (acceso civil del chat) son códigos reservados.
 */
export type Rol = string;

/**
 * Usuario del sistema. El `username` es único a nivel global (el tenant se
 * deduce del usuario al iniciar sesión). Cada usuario está asociado a un tenant
 * por `tenant` (código); el superadmin no tiene tenant (nulo). La contraseña se
 * guarda hasheada con bcrypt, nunca en claro.
 */
@Entity({ name: 'usuarios' })
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  username!: string;

  /** Código del tenant al que pertenece. Nulo solo para el superadmin. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tenant?: string | null;

  @Column({ type: 'varchar', length: 200 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  /** Código del rol (dinámico por tenant, ver RolesService). */
  @Column({ type: 'varchar', length: 40, default: 'operador' })
  rol!: string;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
