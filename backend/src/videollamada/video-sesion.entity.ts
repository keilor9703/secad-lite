import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * PENDIENTE   creada; el enlace salió pero el ciudadano no ha entrado.
 * CONECTADA   el ciudadano entró.
 * FINALIZADA  alguien colgó.
 * EXPIRADA    se venció sin que nadie entrara.
 */
export type EstadoVideoSesion = 'PENDIENTE' | 'CONECTADA' | 'FINALIZADA' | 'EXPIRADA';

/**
 * Una videollamada con el ciudadano, anclada a un caso.
 *
 * El video NO pasa por el servidor: va punto a punto entre el navegador del
 * ciudadano y el del despachador (WebRTC, atravesando NAT con el TURN). Aquí
 * queda lo que hay que saber del hecho: quién la abrió, cuándo entró el
 * ciudadano, desde qué IP, dónde estaba, y cuándo terminó.
 */
@Entity({ name: 'video_sesiones' })
@Index(['tenant', 'casoId', 'creadoEn'])
@Index(['tenant', 'estado'])
@Index(['tenant', 'codigo'], { unique: true })
export class VideoSesionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  casoId!: string;

  @Column({ type: 'varchar', length: 12, default: 'PENDIENTE' })
  estado!: EstadoVideoSesion;

  /**
   * Código público de la llamada: lo que el ciudadano recibe en el SMS.
   *
   * Antes el enlace llevaba el JWT entero —más de 300 caracteres— y en un
   * mensaje de texto eso parece cualquier cosa menos la línea de emergencias.
   * Aquí va un código corto y dictable por teléfono; el token firmado lo
   * entrega el servidor cuando el código resulta válido.
   */
  @Column({ type: 'varchar', length: 24, nullable: true })
  codigo!: string | null;

  /** Quién la abrió (JwtPayload.sub). */
  @Column({ type: 'varchar', length: 120 })
  usuarioDespachador!: string;

  /** A qué número se mandó el enlace. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  numeroTelefono?: string | null;

  /**
   * Hasta cuándo sirve el enlace. Es la misma fecha que va firmada dentro del
   * token, y se guarda para poder volver a firmarlo con la vigencia que le
   * queda cuando el despachador se reconecta.
   */
  @Column({ type: 'timestamptz' })
  expiraEn!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  conectadoEn?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finalizadoEn?: Date | null;

  /** Desde dónde entró el ciudadano. Queda como parte del registro del hecho. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipCiudadano?: string | null;

  // --- Última ubicación reportada por el ciudadano ---------------------------
  //
  // Se guarda la ÚLTIMA, no el histórico: lo que necesita el despachador es
  // dónde está ahora para mandar la unidad. Un rastro de posiciones sería otra
  // cosa —y otra decisión, con otras implicaciones— y no es lo que esto es.

  @Column({ type: 'double precision', nullable: true })
  ultimaLat?: number | null;

  @Column({ type: 'double precision', nullable: true })
  ultimaLng?: number | null;

  /** Radio de incertidumbre en metros que reporta el navegador. */
  @Column({ type: 'double precision', nullable: true })
  ultimaPrecision?: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  ultimaUbicacionEn?: Date | null;

  /** Archivo de la grabación, cuando se grabó. Ver ArchivosService. */
  @Column({ type: 'uuid', nullable: true })
  archivoGrabacionId?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
