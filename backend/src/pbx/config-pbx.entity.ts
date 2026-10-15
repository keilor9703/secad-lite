import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Qué planta telefónica atiende a esta instancia.
 *
 * `YACO` es el proveedor con el que opera hoy: manda el webhook genérico de
 * `/api/pbx/webhook` y no necesita credenciales nuestras, solo la API key del
 * tenant. `ZADARMA` es la centralita en la nube que FALCON opera por su
 * cuenta: ahí sí hacen falta las llaves, para verificar lo que llega y para
 * pedirle cosas a su API (grabaciones, llamada saliente).
 */
export type ProveedorPbx = 'YACO' | 'ZADARMA';

/**
 * Configuración de la planta telefónica de UNA instancia.
 *
 * Es por instancia y no de la plataforma —a diferencia del SMS— porque la
 * línea del 123 es del municipio: su número, su centralita, su factura. Dos
 * municipios no comparten planta.
 *
 * **Apagable, como las demás integraciones.** Hay dos interruptores y hacen
 * cosas distintas a propósito:
 *
 *  - `integraciones` del tenant (sin `'pbx'`): la instancia no contrató
 *    telefonía. No hay módulo, no hay cola de llamadas, la interfaz no la
 *    menciona. Lo decide quien vende.
 *  - `activo` de esta fila: la instancia SÍ tiene telefonía, pero esta planta
 *    está apagada ahora mismo —una migración a medias, una prueba, un
 *    proveedor caído—. El webhook rechaza lo que llegue y lo deja anotado en
 *    vez de perderlo en silencio. Lo decide quien opera.
 *
 * Sin fila, el comportamiento es el de siempre (`YACO` por el webhook
 * genérico): esta tabla no puede romper a los que ya funcionan.
 */
@Entity({ name: 'config_pbx' })
export class ConfigPbxEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código del tenant. Una planta por instancia. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  @Column({ type: 'varchar', length: 16, default: 'YACO' })
  proveedor!: ProveedorPbx;

  /** Apagado: se registra lo que llegue, pero no se crea ninguna llamada. */
  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  /** Zadarma: la clave de usuario de la API (no es secreta por sí sola). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  zadarmaKey?: string | null;

  /**
   * Zadarma: el secreto. CIFRADO en reposo (AES-256-GCM, ver
   * `common/secretos.ts`) y no como digest, porque hay que poder recuperarlo:
   * con él se verifica la firma de cada webhook y se firman las llamadas a su
   * API. Nunca sale hacia el navegador.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  zadarmaSecreto?: string | null;

  /**
   * El número que marca el ciudadano (E.164). Informativo para la pantalla y
   * para los informes; el enrutamiento lo decide la planta, no FALCON.
   */
  @Column({ type: 'varchar', length: 24, nullable: true })
  numeroEntrante?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
