/** Canal por el que entra un caso (multicanal). */
export type Canal = 'llamada' | 'chat' | 'whatsapp' | 'integracion';

/** Ciclo de vida del caso. `despachado` = con recursos en atención. */
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'despachado' | 'derivado' | 'cerrado';

/** Prioridad del caso; la sugiere el código y el operador puede cambiarla. */
export type PrioridadCaso = 'alta' | 'media' | 'baja';

export const CANALES: Canal[] = ['llamada', 'chat', 'whatsapp', 'integracion'];
export const ESTADOS: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];
export const PRIORIDADES: PrioridadCaso[] = ['alta', 'media', 'baja'];

/**
 * Cómo terminó el caso. Es obligatorio al cerrar porque es lo que permite
 * contar después cuántos fueron efectivos, cuántos falsa alarma y cuántos se
 * perdieron por no tener unidad disponible.
 */
export interface CodigoCierre { codigo: string; etiqueta: string; }
export const CODIGOS_CIERRE: CodigoCierre[] = [
  { codigo: 'atendido',     etiqueta: 'Atendido efectivamente' },
  { codigo: 'falsa_alarma', etiqueta: 'Falsa alarma' },
  { codigo: 'sin_merito',   etiqueta: 'Sin mérito / no procede' },
  { codigo: 'duplicado',    etiqueta: 'Caso duplicado' },
  { codigo: 'remitido',     etiqueta: 'Remitido a otra entidad' },
  { codigo: 'sin_recurso',  etiqueta: 'Sin recurso disponible' },
  { codigo: 'desistido',    etiqueta: 'El ciudadano desiste' },
  { codigo: 'informativo',  etiqueta: 'Solo informativo' },
];
export const CLAVES_CIERRE: string[] = CODIGOS_CIERRE.map((c) => c.codigo);

// La forma persistida del caso vive en caso.entity.ts (CasoEntity).
