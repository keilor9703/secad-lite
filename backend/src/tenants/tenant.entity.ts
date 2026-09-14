import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Plan contratado por el tenant. */
export type PlanTenant = 'basico' | 'estandar' | 'avanzado';
export const PLANES: PlanTenant[] = ['basico', 'estandar', 'avanzado'];

/** Estado de la suscripción: en prueba, al día o suspendida por cartera. */
export type EstadoSuscripcion = 'prueba' | 'activa' | 'suspendida';
export const ESTADOS_SUSCRIPCION: EstadoSuscripcion[] = ['prueba', 'activa', 'suspendida'];

/** Integraciones que se pueden habilitar por tenant. */
export const INTEGRACIONES = ['pbx', 'whatsapp', 'api', 'cti'] as const;
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

  // --- Identidad territorial (DIVIPOLA/DANE) ----------------------------------
  // Un tenant es un municipio/corregimiento: estos datos alinean el registro
  // con la división político-administrativa oficial, para reportes que crucen
  // o agrupen instancias por departamento/región sin depender de que el
  // `nombre` libre coincida con el nombre oficial.

  /** Código DANE (DIVIPOLA) del municipio: 2 dígitos de depto + 3 de municipio. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  codigoDane?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  departamento?: string | null;

  /** Nombre oficial del municipio/corregimiento; puede diferir del `nombre` con el que opera. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  municipio?: string | null;

  /** Subregión (p. ej. "Valle de Aburrá" en Antioquia); no todos los deptos las tienen formalizadas. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  subregion?: string | null;

  /**
   * Bandera/logo del tenant, como data URL (p. ej. "data:image/png;base64,…").
   * Se muestra pequeño junto al selector/indicador de tenant en la barra
   * superior, para darle identidad a cada municipio dentro del sistema.
   */
  @Column({ type: 'text', nullable: true })
  logoDataUrl?: string | null;

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

  /**
   * A quién se envía un caso que llega por remisión de OTRA jurisdicción
   * (otro tenant): agencia responsable y sus canales, en el catálogo de
   * ESTE tenant (el destino). Sin esto configurado, el caso llega sin
   * asignar — solo lo ve un supervisor (casos.ver_todos) hasta que alguien
   * lo enrute a mano.
   */
  @Column({ type: 'uuid', nullable: true })
  remisionAgenciaResponsableId?: string | null;

  @Column({ type: 'simple-array', nullable: true })
  remisionCanales?: string[] | null;

  /**
   * Clave de API dedicada a la integración CTI/YACO (barra CTI embebida):
   * autentica las peticiones que el backend de esa integración le hace a
   * FALCON CAD. Separada de `apiKey` a propósito — es una superficie más
   * sensible (involucra SSO de agentes) y no debe compartir credencial con
   * el webhook básico de PBX. Igual que `apiKey`, se guarda como digest.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80, nullable: true })
  ctiApiKey?: string | null;

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
