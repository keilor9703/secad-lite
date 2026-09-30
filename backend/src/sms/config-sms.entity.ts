import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Proveedores de SMS soportados. Añadir uno es un remitente más y un caso aquí. */
export type ProveedorSms = 'INFOBIP' | 'INALAMBRIA_EXPRESS';

/**
 * Credenciales del proveedor de SMS de la plataforma.
 *
 * Hay UNA sola fila —la de `TENANT_CONFIG_SMS`—: la cuenta del proveedor y su
 * factura son del operador del SaaS, no de cada municipio, y la gestiona el
 * superadmin desde Plataforma. La columna `tenant` es la llave única de esa
 * fila, no una configuración por instancia.
 *
 * La `apiKey` se guarda CIFRADA (AES-256-GCM, ver common/secretos.ts) y no como
 * digest: a diferencia de una llave que se compara, esta hay que poder usarla
 * para autenticar contra el proveedor, así que el sistema necesita recuperarla.
 * Nunca sale hacia el navegador — ver SmsGlobalController.
 */
@Entity({ name: 'config_sms' })
export class ConfigSmsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Una configuración por instancia. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  @Column({ type: 'varchar', length: 24, default: 'INFOBIP' })
  proveedor!: ProveedorSms;

  /** Cifrada en reposo. Vacía = no hay SMS configurado y no se intenta enviar. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  apiKey?: string | null;

  /**
   * Host del proveedor. Infobip da uno propio por cuenta
   * (xxxxx.api.infobip.com), así que no se puede quemar en el código.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  baseUrl?: string | null;

  /** Remitente que ve el ciudadano. Solo lo usa Infobip. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sender?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
