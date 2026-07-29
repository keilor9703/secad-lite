/** Canal por el que entra un caso (multicanal). */
export type Canal = 'llamada' | 'chat' | 'integracion';

/** Ciclo de vida del caso. `despachado` = con recursos en atención. */
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'despachado' | 'derivado' | 'cerrado';

export const CANALES: Canal[] = ['llamada', 'chat', 'integracion'];
export const ESTADOS: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];

// La forma persistida del caso vive en caso.entity.ts (CasoEntity).
