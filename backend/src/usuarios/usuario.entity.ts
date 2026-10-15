import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Código de rol. Con el RBAC dinámico los roles viven en la tabla `roles` por
 * tenant; aquí solo queda el alias de tipo. 'superadmin' (global) es el único
 * código reservado.
 */
export type Rol = string;

/**
 * Usuario del sistema. El `username` es único en TODA la plataforma, no solo
 * dentro de su tenant: dos secads no pueden tener cada uno un "carlos"
 * propio — evita que un mismo usuario/contraseña caiga ambiguamente en dos
 * tenants distintos al iniciar sesión (ver `UsuariosService.crear` y
 * `.validar`). Cada usuario está asociado a un tenant por `tenant` (código);
 * el superadmin no tiene tenant (nulo). La contraseña se guarda hasheada con
 * bcrypt, nunca en claro.
 */
@Entity({ name: 'usuarios' })
@Index(['username'], { unique: true })
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  /**
   * Agencia (entidad) a la que pertenece el funcionario — agencias.id. Es la
   * que queda como origen de todo caso que recepcione. Nula para el superadmin
   * y para los ciudadanos.
   */
  @Column({ type: 'uuid', nullable: true })
  agenciaId?: string | null;

  /**
   * Canales de atención asignados (canales.id). Determinan qué casos ve en su
   * bandeja de despacho. Se guardan como lista simple: son pocos por usuario y
   * el resto del modelo tampoco usa relaciones.
   */
  @Column({ type: 'simple-array', nullable: true })
  canales?: string[] | null;

  /**
   * Extensión del funcionario en la planta telefónica (PBX). Es lo que permite
   * dirigir una llamada ya enrutada por el ACD de la central a la sesión de
   * ESTE operador y no a todo el tenant. Se asigna aquí porque la asignación
   * en sí vive en la central, no en FALCON CAD — este es solo el mapeo.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  extension?: string | null;

  /**
   * Clave SIP de esa extensión, para contestar DENTRO de FALCON.
   *
   * CIFRADA en reposo (AES-256-GCM, ver `common/secretos.ts`) y no como
   * digest, porque hay que poder recuperarla: es lo que el navegador del
   * operador usa para registrarse como teléfono en la central.
   *
   * **Sí viaja al navegador**, y eso es inevitable, no un descuido: en un
   * softphone web el que se registra es el navegador. Lo que se puede acotar
   * es el alcance, y se acota: solo la del usuario que la pide, solo por la
   * ruta del softphone, y nunca en un registro ni en una respuesta de
   * administración —ahí solo se dice si está puesta—.
   *
   * Es por usuario y no por instancia porque cada extensión tiene la suya: con
   * una compartida, dos operadores se registrarían como el mismo teléfono y la
   * central entregaría la llamada a cualquiera de los dos.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  sipClave?: string | null;

  /**
   * "@" de WhatsApp del funcionario, para la integración CTI/YACO: permite
   * vincular una conversación de WhatsApp que llega por esa vía a ESTE
   * operador. Igual que `extension`, es solo el mapeo — la asignación en sí
   * la decide la central, no FALCON CAD.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  whatsappHandle?: string | null;

  // ── Correo ──────────────────────────────────────────────────────────────

  /**
   * Correo del funcionario. A dónde va su invitación para elegir contraseña,
   * y por dónde recupera el acceso cuando la olvida en un turno de noche.
   *
   * NO lleva restricción de unicidad, a propósito. Hay municipios pequeños
   * donde una oficina entera comparte un solo buzón institucional, y no hay
   * nada que proteger exigiendo unicidad: la recuperación se pide por
   * USERNAME, no por correo, así que nunca hay dos cuentas que disputen un
   * mismo enlace. La interfaz sí avisa si la dirección ya está en uso, para
   * que un error de digitación no pase inadvertido.
   *
   * Nulo en las cuentas creadas antes de que existiera el campo.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  correo?: string | null;

  /**
   * Cuándo se comprobó que la dirección existe y es de esta persona. Se marca
   * al usar un enlace de activación o de recuperación: el único que puede
   * usarlo es quien abre ese buzón.
   *
   * Un correo escrito por un administrador y nunca verificado no sirve como
   * identidad — un dedo de más en el teclado manda la invitación a un
   * desconocido. Hasta que esto tenga fecha, la dirección es una suposición.
   */
  @Column({ type: 'timestamptz', nullable: true })
  correoVerificadoEn?: Date | null;

  /** Última vez que el proveedor de correo reportó que la dirección rebota. */
  @Column({ type: 'timestamptz', nullable: true })
  correoRebotadoEn?: Date | null;

  /** Qué dijo el proveedor al rebotar, para que el administrador sepa qué corregir. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  correoRebotadoMotivo?: string | null;

  /**
   * Cuándo salió la última invitación. Con `correoVerificadoEn` en nulo, le
   * dice al administrador que la cuenta existe pero nadie la ha activado.
   */
  @Column({ type: 'timestamptz', nullable: true })
  invitacionEnviadaEn?: Date | null;

  /**
   * Por qué falló el último envío, si falló. Crear la cuenta NUNCA se aborta
   * porque el proveedor de correo esté caído: el alta se completa, el error
   * queda aquí, y el administrador puede copiar el enlace y pasarlo por otra
   * vía. Un alta bloqueada por un tercero es inaceptable en un CAD.
   */
  @Column({ type: 'varchar', length: 300, nullable: true })
  invitacionError?: string | null;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  // ── Doble factor (TOTP) ────────────────────────────────────────────────
  // El secreto va CIFRADO en reposo (common/secretos.ts). Nunca sale hacia el
  // navegador: solo se usa dentro del servidor para verificar el código.

  /** Secreto TOTP cifrado. Vacío = el usuario todavía no se ha enrolado. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  mfaSecreto?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mfaActivadoEn?: Date | null;

  /**
   * Paso de tiempo del último código aceptado. Impide que el MISMO código
   * valga dos veces dentro de su ventana de 90 segundos: sin esto, quien vea
   * el código por encima del hombro puede usarlo después.
   */
  @Column({ type: 'bigint', nullable: true })
  mfaUltimoContador?: string | null;

  @Column({ type: 'int', default: 0 })
  mfaIntentosFallidos!: number;

  @Column({ type: 'timestamptz', nullable: true })
  mfaBloqueoHasta?: Date | null;
}
