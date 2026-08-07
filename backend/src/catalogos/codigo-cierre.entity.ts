import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Cómo terminó un caso. Es obligatorio al cerrar porque es lo que permite
 * contar después cuántos fueron efectivos, cuántos falsa alarma y cuántos se
 * perdieron por no tener unidad disponible. Cada secad maneja el suyo: la
 * clasificación de una policía no es la de un cuerpo de bomberos.
 */
@Entity({ name: 'codigos_cierre' })
@Index(['tenant', 'codigo'], { unique: true })
export class CodigoCierreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  tenant!: string;

  /** Clave que queda grabada en el caso (casos.codigoCierre). No se renombra. */
  @Column({ type: 'varchar', length: 32 })
  codigo!: string;

  /** Lo que ve el operador en el desplegable y lo que sale en los reportes. */
  @Column({ type: 'varchar', length: 120 })
  etiqueta!: string;

  @Column({ type: 'boolean', default: true })
  activo!: boolean;
}
