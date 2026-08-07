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
 * perdieron por no tener unidad disponible. La lista ya no vive aquí: es un
 * catálogo por secad (catalogos/codigo-cierre.entity.ts), porque la
 * clasificación de una policía no es la de un cuerpo de bomberos.
 */
export interface CodigoCierre { codigo: string; etiqueta: string; }

// La forma persistida del caso vive en caso.entity.ts (CasoEntity).
