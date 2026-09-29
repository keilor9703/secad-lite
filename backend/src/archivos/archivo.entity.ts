import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** De dónde salió el archivo. Cambia quién puede verlo y por qué existe. */
export type OrigenArchivo = 'ADJUNTO' | 'GRABACION';

/**
 * EN_CURSO   el archivo se está subiendo; todavía no está completo.
 * COMPLETO   terminó de subirse y se puede descargar.
 * FALLIDO    se abandonó a medias (ver ArchivosService.barrerAbandonados).
 */
export type EstadoArchivo = 'EN_CURSO' | 'COMPLETO' | 'FALLIDO';

/**
 * Metadatos de un archivo del caso: un adjunto que sube el operador, o la
 * grabación de una videollamada.
 *
 * El CONTENIDO no está aquí, está en `archivos_chunks` — ver esa entidad para
 * el porqué. Aquí queda lo que se consulta al listar (nombre, tipo, tamaño,
 * quién y cuándo), que es lo que pide una bandeja de adjuntos y no justifica
 * traer megabytes de la base.
 */
@Entity({ name: 'archivos' })
@Index(['tenant', 'casoId', 'creadoEn'])
@Index(['tenant', 'estado'])
export class ArchivoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Todo archivo cuelga de un caso: no hay archivos sueltos en el sistema. */
  @Column({ type: 'uuid' })
  casoId!: string;

  /** Nombre original, ya saneado (ver ArchivosService.nombreSeguro). */
  @Column({ type: 'varchar', length: 200 })
  nombre!: string;

  @Column({ type: 'varchar', length: 120 })
  tipoMime!: string;

  /**
   * Bytes acumulados. Se va sumando a medida que llegan los trozos, así que
   * mientras el archivo está EN_CURSO refleja lo que hay guardado hasta ahora
   * —que es justo lo que hay que mostrarle a quien está grabando—.
   */
  @Column({ type: 'bigint', default: 0 })
  bytes!: string;

  @Column({ type: 'varchar', length: 12, default: 'EN_CURSO' })
  estado!: EstadoArchivo;

  @Column({ type: 'varchar', length: 12, default: 'ADJUNTO' })
  origen!: OrigenArchivo;

  /** Quién lo subió (JwtPayload.sub), o 'ciudadano' si vino del enlace público. */
  @Column({ type: 'varchar', length: 120 })
  usuario!: string;

  /** Descripción libre que escribe el operador al adjuntar. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  descripcion?: string | null;

  /**
   * Videollamada de la que salió, cuando origen = GRABACION. Es lo que permite
   * ir de la sesión a su grabación sin buscar por nombre de archivo.
   */
  @Column({ type: 'uuid', nullable: true })
  videoSesionId?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  /** Cuándo se cerró. Null mientras siga EN_CURSO. */
  @Column({ type: 'timestamptz', nullable: true })
  completadoEn?: Date | null;

  /** Último trozo recibido — lo usa el barrido de abandonados. */
  @Column({ type: 'timestamptz', nullable: true })
  ultimoChunkEn?: Date | null;
}
