import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Registro crudo de cada evento entrante de la integración CTI/YACO, tal como
 * llegó. Es un esqueleto deliberado: mientras no se conozca el contrato final
 * del proveedor (payload exacto, semántica de reintentos), FALCON CAD guarda
 * el evento para trazabilidad/depuración en vez de intentar interpretarlo —
 * evita perder información entrante mientras se termina de definir el flujo
 * real (creación de caso, ACD, grabaciones), que se construirá sobre esto.
 */
@Entity({ name: 'cti_eventos' })
@Index(['tenant', 'creadoEn'])
export class CtiEventoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Identificador de interacción declarado por el proveedor, si vino. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  identificadorInteraccion?: string | null;

  /** Cuerpo completo recibido, sin interpretar. */
  @Column({ type: 'jsonb' })
  payload!: unknown;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
