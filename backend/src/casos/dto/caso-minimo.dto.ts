import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CANALES, Canal } from '../caso.model';

/**
 * Lo que hace falta para abrir un caso MÍNIMO desde Recepción cuando el
 * operador digitó el abonado a mano, antes de terminar el formulario.
 *
 * Con decoradores en TODOS los campos a propósito: el `ValidationPipe` de
 * `main.ts` corre con `whitelist: true` y descarta cualquier propiedad sin
 * decorador — un campo sin validar llega vacío al servicio y el fallo aparece
 * lejos de su causa.
 */
export class CasoMinimoDto {
  /** Abonado tal como lo escribió el operador. */
  @IsString() @MinLength(5) @MaxLength(40)
  telefono!: string;

  /** «Quién reporta», si ya lo alcanzó a escribir. */
  @IsOptional() @IsString() @MaxLength(120)
  ciudadano?: string;

  /** Medio de comunicación ya elegido en el formulario. */
  @IsOptional() @IsIn(CANALES)
  canal?: Canal;
}
