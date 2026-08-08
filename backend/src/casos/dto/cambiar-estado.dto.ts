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
}
