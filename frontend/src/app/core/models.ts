export type Canal = 'llamada' | 'chat' | 'whatsapp' | 'integracion';
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
  lat?: number | null;
  lng?: number | null;
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
  lat?: number | null;
  lng?: number | null;
}

// --- PBX / planta telefónica ---
export type EstadoLlamada = 'sonando' | 'atendida' | 'perdida' | 'finalizada';

export interface Llamada {
  id: string;
  tenant: string;
  callId?: string | null;
  numero: string;
  numeroDestino?: string | null;
  estado: EstadoLlamada;
  casoId?: string | null;
  atendidaPor?: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface PbxConfig {
  apiKey: string;
  webhookPath: string;
}

export interface WhatsappConfig {
  phoneNumberId: string | null;
  tokenConfigurado: boolean;
  verifyToken: string;
  webhookPath: string;
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
  lat?: number | null;
  lng?: number | null;
}

/** Recurso disponible con su cercanía estimada al caso (distancia + ETA). */
export interface RecursoSugerido {
  recurso: Recurso;
  distanciaKm: number | null;
  etaMin: number | null;
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

/**
 * Código de rol. Con el RBAC dinámico los roles viven por tenant en el backend;
 * 'superadmin' (global) y 'ciudadano' (acceso civil) son reservados.
 */
export type Rol = string;

export interface Sesion {
  token: string;
  usuario: string;
  nombre: string;
  tipo: 'institucional' | 'civil';
  rol: Rol;
  /** Permisos efectivos del rol (RBAC dinámico), emitidos en el login. */
  permisos?: string[];
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

// --- API entrante (entidades externas) ---
export interface EntidadExterna {
  id: string;
  tenant: string;
  nombre: string;
  agencia: string;
  apiKey: string;
  activa: boolean;
  creadoEn?: string;
}

// --- RBAC dinámico (roles y permisos por tenant) ---
export interface PermisoDef {
  clave: string;
  etiqueta: string;
  grupo: string;
}

export interface RolTenant {
  id: string;
  tenant: string;
  codigo: string;
  nombre: string;
  permisos: string[];
  esSistema: boolean;
  creadoEn?: string;
}
