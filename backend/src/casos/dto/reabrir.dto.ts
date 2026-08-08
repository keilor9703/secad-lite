import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ESTADOS, EstadoCaso } from '../caso.model';

/** Solicitud de reapertura que deja quien no tiene autorización para reabrir. */
export class SolicitarReaperturaDto {
  @IsString() @MaxLength(1000)
  motivo!: string;
}

/** Reapertura autorizada: la observación queda en la trazabilidad del caso. */
export class ReabrirDto {
  @IsString() @MaxLength(1000)
  motivo!: string;

  /** Estado en el que queda al reabrirse; por defecto vuelve a gestión. */
  @IsOptional() @IsIn(ESTADOS)
  estado?: EstadoCaso;
}
