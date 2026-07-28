export type Canal = 'llamada' | 'chat' | 'integracion';
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'derivado' | 'cerrado';

export interface Caso {
  id: string;
  tenant: string;
  canal: Canal;
  titulo: string;
  descripcion: string;
  ciudadano: string;
  telefono?: string;
  agencia: string;
  estado: EstadoCaso;
  creadoPor: string;
  creadoEn: string;
  actualizadoEn: string;
}

export interface CrearCaso {
  canal: Canal;
  titulo: string;
  descripcion?: string;
  ciudadano: string;
  telefono?: string;
  agencia?: string;
}

export interface Sesion {
  token: string;
  usuario: string;
  nombre: string;
  tipo: 'institucional' | 'civil';
  tenant: string;
}
