import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Registro de los intentos AL WEBHOOK DE PBX que se rechazaron — API key
 * inválida, tenant suspendido/sin el módulo, body mal formado, o un
 * `colgada` que no encuentra la llamada. Las peticiones que SÍ se aceptan no
 * se duplican aquí: ya quedan como su propio registro de negocio en
 * `llamadas`. Esto es solo para diagnosticar "la central dice que lo mandó
 * y no aparece" sin depender de logs de proceso, que se pierden al
 * reiniciar. No es multitenant (no pasa por RLS): un intento con API key
 * inválida no tiene tenant que aislar.
 */
@Entity({ name: 'pbx_webhook_rechazado' })
@Index(['creadoEn'])
export class PbxWebhookRechazadoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Solo se conoce si la API key alcanzó a resolver un tenant antes del rechazo. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tenant?: string | null;

  @Column({ type: 'int' })
  estadoHttp!: number;

  /** El mismo mensaje que se le respondió a la central. */
  @Column({ type: 'text' })
  motivo!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip?: string | null;

  /** El body tal como llegó (nunca incluye la API key: esa viaja en un header, no en el body). */
  @Column({ type: 'text', nullable: true })
  cuerpo?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
