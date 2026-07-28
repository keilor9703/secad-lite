/** Canal por el que entra un caso (multicanal). */
export type Canal = 'llamada' | 'chat' | 'integracion';

/** Ciclo de vida mínimo de un caso. */
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'derivado' | 'cerrado';

export const CANALES: Canal[] = ['llamada', 'chat', 'integracion'];
export const ESTADOS: EstadoCaso[] = ['nuevo', 'en_gestion', 'derivado', 'cerrado'];

/** Un incidente recepcionado. */
export interface Caso {
  id: string;
  tenant: string;
  canal: Canal;
  titulo: string;
  descripcion: string;
  ciudadano: string;
  telefono?: string;
  agencia: string;          // agencia responsable (multi-agencia)
  estado: EstadoCaso;
  creadoPor: string;
  creadoEn: string;         // ISO
  actualizadoEn: string;    // ISO
}
