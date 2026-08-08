import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Remisión de un caso a canales de atención. Sirve tanto para sumar canales
 * (gestión conjunta: varias entidades atienden a la vez) como para trasladarlo
 * a otra agencia dejándolo fuera de la cola anterior.
 */
export class RemitirDto {
  /** Agencia destino (agencias.id). Si se omite, se mantiene la responsable. */
  @IsOptional() @IsString() @MaxLength(64)
  agenciaResponsableId?: string;

  /** Canales destino, todos de esa agencia. */
  @IsArray() @IsString({ each: true })
  canales!: string[];

  /** Motivo de la remisión; queda en la bitácora. */
  @IsOptional() @IsString() @MaxLength(1000)
  observacion?: string;

  /**
   * `true` traslada el caso: los canales indicados reemplazan a los anteriores
   * y el caso desaparece de la cola de la agencia previa. `false` (por defecto)
   * los suma, para que ambas entidades lo atiendan.
   */
  @IsOptional() @IsBoolean()
  exclusivo?: boolean;
}
