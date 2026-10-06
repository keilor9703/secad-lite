import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** De dónde salió el archivo. Cambia quién puede verlo y por qué existe. */
export type OrigenArchivo = 'ADJUNTO' | 'GRABACION';

/**
 * El ciclo de vida de una grabación. NINGÚN estado implica que se haya
 * borrado: lo que cambia es DÓNDE están los bytes, nunca si existen.
 *
 * EN_CURSO     se está subiendo; todavía no está completo.
 * COMPLETO     terminó de subirse. Los bytes están en la base.
 * FALLIDO      se abandonó a medias (ver ArchivosService.barrerAbandonados).
 * ARCHIVADO    los bytes salieron de la base al almacenamiento de objetos y se
 *              sirven desde allá (ver ArchivadoService). Sigue abriéndose con
 *              un clic: para quien lo mira, no hay diferencia.
 * EN_CUSTODIA  ya no está ni en la base ni en el bucket: está en el archivo
 *              permanente fuera de línea (la NAS). El caso lo sigue listando,
 *              con el nombre exacto del archivo, y dice que hay que pedirlo.
 *              Se llega aquí SOLO después de comprobar byte a byte que la copia
 *              de la NAS coincide con el original — nunca por antigüedad.
 */
export type EstadoArchivo = 'EN_CURSO' | 'COMPLETO' | 'FALLIDO' | 'ARCHIVADO' | 'EN_CUSTODIA';

/**
 * ¿Falcon puede entregar el contenido ahora mismo?
 *
 * Separado del estado porque es la pregunta que se hacen el controlador y la
 * pantalla, y porque el día que haya un quinto sitio donde vivan los bytes,
 * esto es lo único que hay que tocar.
 */
export function sePuedeDescargar(estado: EstadoArchivo): boolean {
  return estado === 'COMPLETO' || estado === 'ARCHIVADO' || estado === 'EN_CURSO';
}

/** Existe, está íntegro, pero hay que pedírselo al administrador. */
export function estaFueraDeLinea(estado: EstadoArchivo): boolean {
  return estado === 'EN_CUSTODIA';
}

/** Un archivo deja de aceptar trozos en cuanto sale de EN_CURSO. */
export function estaCerrado(estado: EstadoArchivo): boolean {
  return estado !== 'EN_CURSO';
}

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

  // ── Archivado ─────────────────────────────────────────────────────────────
  // Ver la migración ArchivadoGrabaciones y ArchivadoService. La fila sobrevive
  // al archivado: lo que sale de la base son los bytes, no la constancia.

  /** Cuándo salieron los bytes de la base. Null = el contenido sigue aquí. */
  @Column({ type: 'timestamptz', nullable: true })
  archivadoEn?: Date | null;

  /** Dónde está exactamente, en el almacenamiento de objetos. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  objetoRemoto?: string | null;

  /**
   * Hash del contenido original, calculado ANTES de liberar los bytes. Es lo
   * que permite demostrar años después que lo que se descarga es byte a byte lo
   * que se grabó.
   */
  @Column({ type: 'char', length: 64, nullable: true })
  sha256?: string | null;

  /**
   * Cuándo pasó al archivo permanente fuera de línea. Null = sigue en línea.
   *
   * La ruta dentro de la NAS es la MISMA que `objetoRemoto`: el archivo
   * permanente espeja la estructura del bucket. Así el administrador busca por
   * el nombre que ve en pantalla, sin traducir nada, y un día que haya que
   * reconstruir el bucket desde la NAS es una copia directa.
   */
  @Column({ type: 'timestamptz', nullable: true })
  enCustodiaDesde?: Date | null;
}
