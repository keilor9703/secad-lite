import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Qué clase de número es.
 *
 *  - `did`   — un número normal, marcable desde cualquier teléfono del mundo
 *              (`+573001234567`, `+18335308128`). Lo entrega el operador y es
 *              único en el planeta.
 *  - `corto` — un número corto del plan nacional de numeración: el 123, o un
 *              1XY de la alcaldía. **No es único**: el 123 existe en todos los
 *              municipios y en cada uno termina en una sala distinta. Quien lo
 *              entrega no es el operador SIP sino el operador local, por
 *              convenio, y por eso aquí se registra pero no se compra.
 */
export type TipoNumero = 'did' | 'corto';

/**
 * EL NÚMERO QUE MARCA EL CIUDADANO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA TABLA Y NO UNA COLUMNA
 *
 * `config_pbx.numeroEntrante` ya guardaba «el número» de la instancia, y
 * alcanzaba mientras la planta era ajena: ahí el número es informativo,
 * porque el enrutamiento lo decide la central del proveedor.
 *
 * Con planta propia el número deja de ser informativo: es lo que el dialplan
 * mira para decidir a qué cola entra la llamada. Y entonces uno no basta. Un
 * municipio real tiene a la vez el 123 por convenio, un fijo de la alcaldía
 * que la gente ya se sabe, y a veces un número de pruebas. Los tres tienen
 * que caer en la misma sala y uno de ellos puede apagarse sin tocar los
 * otros.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS UNICIDADES DISTINTAS, Y ES A PROPÓSITO
 *
 * - **(tenant, numero)** siempre: el mismo número dos veces en la misma
 *   instancia es un error de dedo que deja dos reglas de enrutamiento
 *   compitiendo.
 * - **(numero) solo para los `did`**: un DID es único en el mundo, así que si
 *   dos instancias dicen tener el mismo, una de las dos está equivocada y la
 *   llamada de una emergencia va a terminar en la sala del municipio vecino.
 *   Mejor que la base no lo permita. Para los `corto` NO aplica, porque el
 *   123 de Itagüí y el 123 de Envigado son legítimamente el mismo número.
 *
 * Eso es un índice único PARCIAL, que es justo lo que Postgres sabe hacer y
 * lo que una validación en el servicio no puede garantizar bajo carrera.
 */
@Entity({ name: 'pbx_numero' })
@Index(['tenant', 'numero'], { unique: true })
export class PbxNumeroEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /**
   * En E.164 con el `+` para los DID (`+573001234567`), tal cual para los
   * cortos (`123`). Con el `+` porque es lo que entregan los operadores en el
   * `To:` —Infobip lo manda así— y porque el día que se compare contra lo que
   * llega, comparar dos formatos distintos es el error clásico.
   */
  @Column({ type: 'varchar', length: 24 })
  numero!: string;

  @Column({ type: 'varchar', length: 16, default: 'did' })
  tipo!: TipoNumero;

  /**
   * Por qué troncal entra. Nula si todavía no se sabe o si entra por
   * convenio con el operador local (los cortos).
   */
  @Column({ type: 'uuid', nullable: true })
  troncalId?: string | null;

  /**
   * A dónde va la llamada al entrar: `cola` (la cola de operadores de la
   * instancia, que es el caso normal) o una extensión concreta, para un
   * número directo de un funcionario.
   */
  @Column({ type: 'varchar', length: 64, default: 'cola' })
  destino!: string;

  /** Para la pantalla: «Línea del 123», «Fijo de la alcaldía». */
  @Column({ type: 'varchar', length: 120, nullable: true })
  descripcion?: string | null;

  /**
   * Apagado, el dialplan no lo atiende. Sirve para dar de baja un número sin
   * borrar la fila: el histórico de llamadas sigue apuntando a él.
   */
  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actualizadoPor?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}

/**
 * El número como lo va a ver el dialplan.
 *
 * Normaliza lo que escribe un humano —espacios, guiones, paréntesis, el `00`
 * de marcación internacional, el `+57` escrito como `57`— a E.164 con `+`.
 * Un número con un guion no casa con NINGÚN patrón del dialplan, y el
 * síntoma es «el número está puesto y la llamada no entra», que es de los
 * peores de diagnosticar porque en pantalla todo se ve bien.
 */
export function normalizarNumero(
  valor: string,
  tipo: TipoNumero = 'did',
): string {
  const limpio = (valor ?? '').replace(/[^\d+]/g, '');
  if (!limpio) return '';
  if (tipo === 'corto') return limpio.replace(/\+/g, '');

  let n = limpio.replace(/\+/g, '');
  // `00` delante es el prefijo internacional de la marcación, no del número.
  if (n.startsWith('00')) n = n.slice(2);
  // Diez dígitos que empiezan por 3 (celular) o por 6 (fijo, desde el plan de
  // numeración de 2022) son un número colombiano escrito como lo escribe
  // todo el mundo aquí: sin indicativo de país.
  if (n.length === 10 && /^[36]/.test(n)) n = `57${n}`;
  return `+${n}`;
}
