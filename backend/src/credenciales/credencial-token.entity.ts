import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Para qué sirve el enlace. Cambia el plazo y el texto del correo, nada más. */
export type TipoCredencial = 'invitacion' | 'recuperacion';

/**
 * Enlace de un solo uso para poner una contraseña.
 *
 * Es la pieza que permite NO mandar nunca una contraseña por correo. El
 * administrador crea la cuenta sin clave; el funcionario recibe un enlace,
 * entra y elige la suya. Así la contraseña no viaja por el proveedor de
 * correo, no se queda en un buzón para siempre, y el administrador no la
 * conoce.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE GUARDA AQUÍ NO ABRE NADA. En la tabla vive el sha256 del token,
 * nunca el token. Quien lea la base —una copia de seguridad extraviada, un
 * volcado para depurar— no puede construir un enlace válido con esto, igual
 * que no puede iniciar sesión con el hash de una contraseña.
 *
 * Se usa sha256 y no bcrypt a propósito: el token son 32 bytes aleatorios, no
 * una palabra que alguien pueda adivinar, así que no hay nada que frenar con
 * un hash lento — y la búsqueda tiene que ser por índice, que bcrypt impide.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Entity({ name: 'credenciales_token' })
@Index(['tokenHash'], { unique: true })
export class CredencialTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cuenta a la que pertenece el enlace (usuarios.id). */
  @Index()
  @Column({ type: 'uuid' })
  usuarioId!: string;

  @Column({ type: 'varchar', length: 20 })
  tipo!: TipoCredencial;

  /** sha256 del token en hexadecimal. El token en claro solo existe en el enlace. */
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  venceEn!: Date;

  /**
   * Cuándo se usó. Con fecha, el enlace está muerto: un correo reenviado, una
   * copia en el historial del navegador o una captura de pantalla dejan de
   * servir en cuanto alguien lo usó una vez.
   */
  @Column({ type: 'timestamptz', nullable: true })
  usadoEn?: Date | null;

  /**
   * Cuándo se anuló sin usarse. Pasa cuando se emite uno nuevo para la misma
   * cuenta: el anterior deja de valer en ese momento, de modo que nunca haya
   * dos enlaces vivos para la misma persona.
   */
  @Column({ type: 'timestamptz', nullable: true })
  anuladoEn?: Date | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  creadoEn!: Date;

  /** Quién lo pidió: el id de un administrador, o 'autoservicio' si lo pidió el propio usuario. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  creadoPor?: string | null;
}
