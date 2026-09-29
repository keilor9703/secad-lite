import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Un trozo del contenido de un archivo.
 *
 * ── Por qué el contenido va en la base y no en disco ───────────────────────
 * FALCON CAD no guarda estado propio: corre replicado detrás de un balanceador
 * y cualquier réplica atiende cualquier petición. Una grabación de videollamada
 * llega por trozos durante varios minutos, y cada trozo puede caer en una
 * réplica distinta — con un archivo temporal en disco, la grabación quedaría
 * partida entre máquinas y no se podría rearmar.
 *
 * Guardando cada trozo como una fila, cualquier réplica puede recibir
 * cualquier trozo, y la evidencia queda a salvo desde el primero: si el puesto
 * del despachador muere a mitad de la llamada, lo grabado hasta ese momento ya
 * está en la base, no en el disco de un servidor que quizá ya no atiende.
 *
 * ── Por qué trozos y no un solo bytea ──────────────────────────────────────
 * Rearmar y reescribir un bytea de 200 MB en cada trozo que llega sería
 * cuadrático. Cada trozo se INSERTA una vez y no se vuelve a tocar; al
 * descargar se leen en orden.
 */
@Entity({ name: 'archivos_chunks' })
// La descarga lee todos los trozos de un archivo EN ORDEN; el único índice
// necesario es ese, y además impone que no haya dos trozos con el mismo
// índice —que es lo que hace idempotente reintentar un envío—.
@Index(['tenant', 'archivoId', 'indice'], { unique: true })
export class ArchivoChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  @Column({ type: 'uuid' })
  archivoId!: string;

  /** Posición dentro del archivo, desde 0. Lo asigna quien sube. */
  @Column({ type: 'int' })
  indice!: number;

  @Column({ type: 'bytea' })
  datos!: Buffer;

  /** Tamaño del trozo. Se guarda para poder sumar sin leer el contenido. */
  @Column({ type: 'int' })
  bytes!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  creadoEn!: Date;
}
