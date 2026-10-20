import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Qué se encontró mal en la última revisión. Vacío = todo bien.
 *
 * Son códigos y no frases para que la pantalla pueda decidir qué enseñar y el
 * correo qué decir, sin leer texto libre.
 */
export type FallaPlanta =
  /** Asterisk no contesta por ARI. La planta está muerta o incomunicada. */
  | 'asterisk'
  /** Asterisk vive, pero la troncal no está disponible: no entran llamadas. */
  | 'troncal'
  /** El certificado del nombre está por vencer. El softphone dejará de conectar. */
  | 'certificado'
  /** El certificado ya venció. */
  | 'certificado-vencido';

/**
 * LA SALUD DE UNA PLANTA, MEDIDA DESDE FUERA.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Porque hasta ahora no existía nada. Si la troncal se caía a las tres de la
 * mañana, nadie se enteraba hasta que alguien llamaba a quejarse. Y la noche
 * del 19 de octubre dejó claro que una planta puede estar «arriba» —contenedor
 * corriendo, puerto escuchando— y no servir para nada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SE MIDE DESDE FUERA, POR EL MISMO CAMINO QUE USA EL OPERADOR
 *
 * Nada de SSH. Las comprobaciones salen del backend de FALCON y entran por el
 * 443 de la planta, que es exactamente el camino que usa el navegador del
 * operador. Eso es deliberado: comprobar por un camino privilegiado que el
 * operador no usa es comprobar otra cosa. Si este chequeo pasa, el softphone
 * puede conectarse; si falla, no.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNA FILA POR PLANTA, NO UN HISTÓRICO
 *
 * Lo que hace falta para operar es «¿está bien ahora?» y «¿desde cuándo está
 * mal?». Un histórico de un chequeo cada cinco minutos son cien mil filas al
 * año por municipio para responder preguntas que nadie hace. El día que haga
 * falta una gráfica, se agrega una tabla aparte.
 *
 * `fallaDesde` es lo que convierte esto en algo operable: sin él, una caída de
 * dos días y una de dos minutos se ven igual.
 */
@Entity({ name: 'planta_salud' })
export class PlantaSaludEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** La instancia. Una fila por planta: la revisión reemplaza a la anterior. */
  @Column({ type: 'varchar', length: 64, unique: true })
  tenant!: string;

  /** ¿Pasó la última revisión sin una sola falla? */
  @Column({ type: 'boolean', default: false })
  bien!: boolean;

  /** Qué se encontró mal, en códigos. Vacío cuando `bien` es cierto. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  fallas!: FallaPlanta[];

  /** La versión que reporta Asterisk. Útil para saber qué imagen corre. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  version?: string | null;

  /**
   * Cuántos operadores tenían el softphone conectado en la última revisión.
   *
   * No es una falla que sea cero —de noche puede no haber nadie— pero es el
   * número que explica por qué una llamada no se contestó.
   */
  @Column({ type: 'int', default: 0 })
  operadores!: number;

  /** Cuándo vence el certificado del nombre de la planta. */
  @Column({ type: 'timestamptz', nullable: true })
  certificadoVence?: Date | null;

  /**
   * Desde cuándo falla, sin interrupción.
   *
   * Se pone en la primera revisión mala y **no se toca** en las siguientes: es
   * lo que distingue «lleva dos minutos» de «lleva dos días». Se borra en
   * cuanto una revisión sale bien.
   */
  @Column({ type: 'timestamptz', nullable: true })
  fallaDesde?: Date | null;

  /**
   * Cuándo se avisó por última vez, y de qué.
   *
   * Existe para no mandar un correo cada cinco minutos mientras algo sigue
   * roto. Se avisa cuando una falla APARECE, no mientras dura.
   */
  @Column({ type: 'timestamptz', nullable: true })
  avisadoEn?: Date | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  avisadoDe!: FallaPlanta[];

  /** El detalle legible de la última revisión, para la pantalla. */
  @Column({ type: 'text', nullable: true })
  detalle?: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  revisadoEn!: Date;
}

/** Cuántos días antes de vencer un certificado empieza a ser una falla. */
export const DIAS_AVISO_CERTIFICADO = 21;

/**
 * ¿Hay algo nuevo que avisar?
 *
 * Avisa cuando aparece una falla que no estaba en el último aviso. No avisa
 * mientras una falla conocida sigue ahí —un correo cada cinco minutos deja de
 * leerse al tercero, y entonces el monitoreo empeora las cosas en vez de
 * mejorarlas— y tampoco avisa cuando una falla desaparece y quedan otras.
 */
export function hayQueAvisar(
  ahora: FallaPlanta[],
  yaAvisado: FallaPlanta[],
): boolean {
  return ahora.some((f) => !yaAvisado.includes(f));
}
