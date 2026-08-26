import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ESTADOS, EstadoCaso } from '../caso.model';

export class CambiarEstadoDto {
  @IsIn(ESTADOS)
  estado!: EstadoCaso;

  /** Agencia destino, requerida solo cuando el estado es 'derivado'. */
  @IsOptional() @IsString() @MaxLength(80)
  agencia?: string;

  /** Obligatorio al cerrar: cómo terminó el caso (catálogo de cierres). */
  @IsOptional() @IsString() @MaxLength(40)
  codigoCierre?: string;

  /** Obligatorio al cerrar: qué pasó, en palabras del despachador. */
  @IsOptional() @IsString() @MaxLength(2000)
  comentario?: string;

  /**
   * Opcional al cerrar: corrige la tipificación del caso contra el mismo
   * catálogo de códigos de caso que se usa en recepción. Un caso puede
   * arrancar como una cosa (p. ej. una riña) y terminar siendo otra (una
   * fiesta con ruido) — esto no es el desenlace (`codigoCierre`), es de qué
   * se trataba en realidad.
   */
  @IsOptional() @IsString() @MaxLength(40)
  codigoCasoFinal?: string;
}
