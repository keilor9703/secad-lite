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

export type TipoEvento = 'creacion' | 'estado' | 'derivacion' | 'nota';

export interface EventoCaso {
  id: string;
  casoId: string;
  tipo: TipoEvento;
  descripcion: string;
  estadoAnterior?: string | null;
  estadoNuevo?: string | null;
  autor: string;
  creadoEn: string;
}

export interface MensajeChat {
  id: string;
  casoId: string;
  autorTipo: 'ciudadano' | 'operador';
  autorNombre: string;
  texto: string;
  creadoEn: string;
}

export type Rol = 'operador' | 'supervisor' | 'admin' | 'ciudadano';

export interface Sesion {
  token: string;
  usuario: string;
  nombre: string;
  tipo: 'institucional' | 'civil';
  rol: Rol;
  tenant: string;
}
