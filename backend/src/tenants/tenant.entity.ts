import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Plan contratado por el tenant. */
export type PlanTenant = 'basico' | 'estandar' | 'avanzado';
export const PLANES: PlanTenant[] = ['basico', 'estandar', 'avanzado'];

/** Estado de la suscripción: en prueba, al día o suspendida por cartera. */
export type EstadoSuscripcion = 'prueba' | 'activa' | 'suspendida';
export const ESTADOS_SUSCRIPCION: EstadoSuscripcion[] = ['prueba', 'activa', 'suspendida'];

/** Integraciones que se pueden habilitar por tenant. */
export const INTEGRACIONES = ['pbx', 'whatsapp', 'api'] as const;
export type Integracion = (typeof INTEGRACIONES)[number];

/**
 * Un tenant: la instancia de un municipio/organización en el modelo
 * multi-inquilino. Cada usuario queda asociado a un tenant por su `codigo`.
 */
@Entity({ name: 'tenants' })
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código corto y único del tenant (p. ej. "demo", "envigado"). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  codigo!: string;

  @Column({ type: 'varchar', length: 160 })
  nombre!: string;

  /**
   * Clave de API del tenant para integraciones entrantes (webhook de la planta
   * telefónica, API de terceros). Secreta; se puede rotar desde administración.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  apiKey?: string | null;

  /** WhatsApp Cloud API: phone_number_id (enruta los mensajes entrantes al tenant). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  waPhoneNumberId?: string | null;

  /** WhatsApp Cloud API: token de acceso para enviar respuestas (secreto). */
  @Column({ type: 'varchar', length: 400, nullable: true })
  waAccessToken?: string | null;

  /**
   * A quién se envían los casos que entran por WhatsApp: agencia responsable
   * (catálogo) y sus canales de atención. Sin esto, un caso de WhatsApp no
   * llega a ninguna bandeja de despacho — solo lo ve un supervisor.
   */
  @Column({ type: 'uuid', nullable: true })
  waAgenciaResponsableId?: string | null;

  @Column({ type: 'simple-array', nullable: true })
  waCanales?: string[] | null;

  // --- Suscripción (FALCON CAD es un servicio por suscripción) ---------------

  /** Plan contratado; hoy solo etiqueta comercial, mañana define cupos. */
  @Column({ type: 'varchar', length: 40, default: 'basico' })
  plan!: PlanTenant;

  /**
   * Estado de la relación comercial. `suspendida` corta el acceso sin borrar
   * nada: el municipio vuelve a operar en cuanto se regulariza.
   */
  @Column({ type: 'varchar', length: 20, default: 'prueba' })
  suscripcion!: EstadoSuscripcion;

  /** Hasta cuándo está pagado. Vencida, nadie del tenant puede entrar. */
  @Column({ type: 'date', nullable: true })
  vence?: string | null;

  /** Motivo del bloqueo, que se le muestra a quien intente entrar. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  motivoBloqueo?: string | null;

  /**
   * Integraciones habilitadas para este tenant (pbx, whatsapp, api). Lo que no
   * esté aquí no se puede usar ni aparece en su interfaz, aunque el código
   * exista: es la palanca comercial de cada módulo.
   */
  @Column({ type: 'simple-array', nullable: true })
  integraciones?: string[] | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
