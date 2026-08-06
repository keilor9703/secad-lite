import { Canal, PrioridadCaso } from '../caso.model';

/**
 * Formulario de recepción. Los datos de quien llama, la tipificación del caso,
 * su ubicación y a quién se envía. La agencia de ORIGEN no viaja aquí: sale
 * siempre del funcionario que recepciona (ver CasosService.crear).
 */
export interface CrearCasoDto {
  /** Medio por el que entró (llamada, chat, WhatsApp, integración). */
  canal: Canal;
  /** Resumen; si se omite, se toma la descripción del código de caso. */
  titulo?: string;
  /** Relato de lo ocurrido (el comentario del operador). */
  descripcion?: string;

  // Quien reporta
  ciudadano: string;
  telefono?: string;
  direccionLlamante?: string;

  // Tipificación
  codigoCaso?: string;
  prioridad?: PrioridadCaso;

  // Ubicación del caso
  ciudad?: string;
  barrio?: string;
  direccion?: string;
  lat?: number;
  lng?: number;

  // Atención
  /** Agencia responsable (agencias.id). */
  agenciaResponsableId?: string;
  /** Canales de atención a los que se envía (canales.id), todos de esa agencia. */
  canales?: string[];

  /** Compatibilidad: nombre de agencia en texto (API entrante y casos antiguos). */
  agencia?: string;
  /** Uso interno (API entrante): entidad externa que radica el caso. */
  entidadId?: string;
}
