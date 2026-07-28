/** Canal por el que entra un caso (multicanal). */
export type Canal = 'llamada' | 'chat' | 'integracion';

/** Ciclo de vida mínimo de un caso. */
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'derivado' | 'cerrado';

export const CANALES: Canal[] = ['llamada', 'chat', 'integracion'];
export const ESTADOS: EstadoCaso[] = ['nuevo', 'en_gestion', 'derivado', 'cerrado'];

// La forma persistida del caso vive en caso.entity.ts (CasoEntity).
