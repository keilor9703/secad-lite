export type Canal = 'llamada' | 'chat' | 'integracion';
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'despachado' | 'derivado' | 'cerrado';

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

export type TipoRecurso = 'patrulla' | 'ambulancia' | 'maquina' | 'moto' | 'otro';
export type EstadoRecurso = 'disponible' | 'asignado' | 'en_ruta' | 'en_sitio' | 'fuera_servicio';

export interface Recurso {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  agencia: string;
  estado: EstadoRecurso;
  activo: boolean;
}

export type EstadoAsignacion = 'asignado' | 'en_ruta' | 'en_sitio' | 'finalizada' | 'cancelada';

export interface Asignacion {
  id: string;
  casoId: string;
  recursoId: string;
  recursoCodigo: string;
  recursoNombre: string;
  estado: EstadoAsignacion;
  asignadoPor: string;
  motivo?: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export type TipoEvento = 'creacion' | 'estado' | 'derivacion' | 'nota' | 'despacho';

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

export type Rol = 'superadmin' | 'admin' | 'supervisor' | 'operador' | 'ciudadano';

export interface Sesion {
  token: string;
  usuario: string;
  nombre: string;
  tipo: 'institucional' | 'civil';
  rol: Rol;
  tenant: string | null;
}

export interface Tenant {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  creadoEn?: string;
}

export interface UsuarioAdmin {
  id: string;
  username: string;
  nombre: string;
  rol: Rol;
  tenant: string | null;
  activo: boolean;
}
