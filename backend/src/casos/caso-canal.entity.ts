import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { EstadoCaso } from './caso.model';

/**
 * El caso, visto por UNA entidad que lo atiende.
 *
 * Un mismo hecho —un accidente con heridos— llega a la vez a tránsito, a salud
 * y a policía, y cada una lo trabaja a su ritmo. Con un solo `estado` en la
 * tabla `casos`, que policía lo tomara lo marcaba como «en gestión» también
 * para bomberos, y que policía lo cerrara lo hacía desaparecer de la bandeja
 * de los demás a mitad de su trabajo.
 *
 * Aquí cada canal destino tiene su propia fila con su propio estado y su
 * propio reloj. La información del incidente y su bitácora siguen siendo una
 * sola y compartida (tabla `casos`); lo que se separa es el flujo de despacho.
 *
 * Relación con las otras tablas:
 *   casos            1  ─┬─  N  casos_canales   (por `casoId`)
 *   casos_eventos    N  ─┘                      bitácora, solo se agrega
 *
 * `casos.estado` pasa a ser un macro-estado: solo llega a `cerrado` cuando
 * TODAS las filas de este caso lo están (ver `CasosService.sincronizarMacroEstado`).
 */
@Entity({ name: 'casos_canales' })
// El tablero de despacho siempre pregunta lo mismo: los casos de UN canal en
// cierto estado. Sin este índice, cada refresco de cada despachador —uno por
// minuto— recorre la tabla entera.
@Index(['tenant', 'canalId', 'estado'])
// La cascada de cierre recorre todas las filas de un caso.
@Index(['tenant', 'casoId'])
// Un caso no puede estar dos veces en el mismo canal: remitir de nuevo al
// mismo sitio actualiza la fila existente, no crea una segunda.
@Index(['tenant', 'casoId', 'canalId'], { unique: true })
export class CasoCanalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** El caso al que pertenece (casos.id). Compartido por todas las filas del mismo hecho. */
  @Column({ type: 'uuid' })
  casoId!: string;

  /** Canal de atención destino (canales.id). */
  @Column({ type: 'uuid' })
  canalId!: string;

  /**
   * Agencia dueña de ese canal, copiada al crear la fila. Se denormaliza a
   * propósito: es lo que permite al supervisor de una entidad ver su trabajo
   * sin depender de `casos.agenciaResponsableId`, que solo nombra a UNA
   * agencia principal y era justamente la causa de que un supervisor de
   * bomberos no viera los casos entrados por policía.
   */
  @Column({ type: 'uuid' })
  agenciaId!: string;

  /** Estado de ESTA entidad frente al caso, independiente del de las demás. */
  @Column({ type: 'varchar', length: 20, default: 'nuevo' })
  estado!: EstadoCaso;

  /** Cómo terminó para esta entidad; solo lo llevan las filas cerradas. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  codigoCierre?: string | null;

  /** Cuándo entró a la bandeja de este canal: el reloj de espera es por canal. */
  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  actualizadoEn!: Date;
}
