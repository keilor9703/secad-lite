import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Política de doble factor de la plataforma. Una sola fila, como config_sms y
 * config_els: la decisión de exigir 2FA es del operador del SaaS, no de cada
 * municipio.
 */
@Entity({ name: 'config_mfa' })
export class ConfigMfaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  /** Si está en false, nadie tiene que enrolarse ni presentar código. */
  @Column({ type: 'boolean', default: true })
  exigido!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
