import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Registro de CADA petición al webhook de PBX, se acepte o se rechace —
 * "la central dice que lo mandó, ¿aparece?" ya no depende de logs de
 * proceso, que se pierden al reiniciar. Las que se aceptan quedan además
 * como su propio registro de negocio en `llamadas` (`llamadaId` apunta ahí);
 * las rechazadas no tienen otro rastro, así que este es el único lugar
 * donde existen. No es multitenant (no pasa por RLS): un intento con API
 * key inválida no tiene tenant que aislar.
 */
@Entity({ name: 'pbx_webhook_log' })
@Index(['creadoEn'])
export class PbxWebhookLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Solo se conoce si la API key alcanzó a resolver un tenant antes de responder. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tenant?: string | null;

  @Column({ type: 'boolean' })
  exitoso!: boolean;

  @Column({ type: 'int' })
  estadoHttp!: number;

  /** 'entrante' | 'colgada', tal como llegó en el body — null si el body ni siquiera traía ese campo. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  evento?: string | null;

  /** El mismo mensaje que se le respondió a la central; null cuando sí se aceptó. */
  @Column({ type: 'text', nullable: true })
  motivo?: string | null;

  /** La llamada creada/actualizada; null cuando se rechazó. */
  @Column({ type: 'uuid', nullable: true })
  llamadaId?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string | null;

  /** El body tal como llegó (nunca incluye la API key: esa viaja en un header, no en el body). */
  @Column({ type: 'text', nullable: true })
  cuerpo?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
