import { IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { CANALES, Canal, PRIORIDADES, PrioridadCaso } from '../caso.model';

/**
 * Formulario de recepción. Los datos de quien llama, la tipificación del caso,
 * su ubicación y a quién se envía. La agencia de ORIGEN no viaja aquí: sale
 * siempre del funcionario que recepciona (ver CasosService.crear).
 *
 * Clase (no interface) a propósito: el ValidationPipe global valida tipos y
 * longitudes ANTES de que el servicio toque los datos — un body con un objeto
 * donde iba un texto ya no revienta en el primer `.trim()`.
 */
export class CrearCasoDto {
  /** Medio por el que entró (llamada, chat, WhatsApp, integración). */
  @IsIn(CANALES)
  canal!: Canal;

  /** Resumen; si se omite, se toma la descripción del código de caso. */
  @IsOptional() @IsString() @MaxLength(200)
  titulo?: string;

  /** Relato de lo ocurrido (el comentario del operador). */
  @IsOptional() @IsString() @MaxLength(5000)
  descripcion?: string;

  // Quien reporta
  @IsString() @MaxLength(120)
  ciudadano!: string;

  @IsOptional() @IsString() @MaxLength(40)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccionLlamante?: string;

  // Tipificación
  @IsOptional() @IsString() @MaxLength(40)
  codigoCaso?: string;

  @IsOptional() @IsIn(PRIORIDADES)
  prioridad?: PrioridadCaso;

  // Ubicación del caso
  @IsOptional() @IsString() @MaxLength(120)
  ciudad?: string;

  @IsOptional() @IsString() @MaxLength(120)
  barrio?: string;

  @IsOptional() @IsString() @MaxLength(200)
  direccion?: string;

  @IsOptional() @IsNumber()
  lat?: number;

  @IsOptional() @IsNumber()
  lng?: number;

  // Atención
  /** Agencia responsable (agencias.id). */
  @IsOptional() @IsString() @MaxLength(64)
  agenciaResponsableId?: string;

  /** Canales de atención a los que se envía (canales.id), todos de esa agencia. */
  @IsOptional() @IsArray() @IsString({ each: true })
  canales?: string[];

  /** Compatibilidad: nombre de agencia en texto (API entrante y casos antiguos). */
  @IsOptional() @IsString() @MaxLength(80)
  agencia?: string;

  /** Uso interno (API entrante): entidad externa que radica el caso. */
  @IsOptional() @IsString() @MaxLength(64)
  entidadId?: string;
}
