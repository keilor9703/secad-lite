import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Credenciales del proveedor de geolocalización automática (Android ELS).
 *
 * Hay UNA sola fila —la de `TENANT_CONFIG_ELS`—, igual que con el SMS: el
 * contrato con el proveedor y su factura son del operador del SaaS, no de cada
 * municipio. Qué municipios pueden usarla se decide aparte, con la integración
 * `els` de cada tenant. La columna `tenant` es la llave única de la fila, no
 * una configuración por instancia.
 *
 * El `secreto` se guarda CIFRADO (AES-256-GCM, ver common/secretos.ts) y no
 * como digest: hay que poder recuperarlo para firmar la autenticación básica
 * contra el proveedor. Nunca sale hacia el navegador — ver ElsGlobalController.
 */
@Entity({ name: 'config_els' })
export class ConfigElsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  /**
   * Raíz del servicio, sin la ruta. El proveedor da un host de pruebas y otro
   * de producción, así que no puede estar quemado en el código.
   * Ej.: https://api-sandbox.rapidsos.com
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  baseUrl?: string | null;

  /**
   * Identificador de la agencia dentro de la ruta del proveedor
   * (.../trigger/hook/{agencia}/trigger). Lo asigna el proveedor por contrato.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  agencia?: string | null;

  /** Usuario de la autenticación básica. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  clienteId?: string | null;

  /** Cifrado en reposo. Vacío = no hay ELS configurado y no se consulta. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  clienteSecreto?: string | null;

  /**
   * Qué mandar como `case_id` cuando todavía no hay caso creado — que es
   * siempre, porque la consulta ocurre MIENTRAS el operador toma la llamada.
   * El proveedor lo documenta como opcional con un valor genérico.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  casoPorDefecto?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
