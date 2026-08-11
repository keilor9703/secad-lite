export type Canal = 'llamada' | 'chat' | 'whatsapp' | 'integracion';
export type EstadoCaso = 'nuevo' | 'en_gestion' | 'despachado' | 'derivado' | 'cerrado';

export interface Caso {
  id: string;
  tenant: string;
  /** Medio por el que entró el caso. */
  canal: Canal;
  titulo: string;
  /** Relato de lo ocurrido (el comentario del operador). */
  descripcion: string;
  ciudadano: string;
  telefono?: string;
  direccionLlamante?: string | null;
  /** Tipificación: código del catálogo y prioridad resultante. */
  codigoCaso?: string | null;
  prioridad?: PrioridadCaso;
  /** Ubicación del incidente. */
  ciudad?: string | null;
  barrio?: string | null;
  direccion?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Nombre de la agencia responsable (denormalizado, para listados). */
  agencia: string;
  agenciaOrigenId?: string | null;
  agenciaResponsableId?: string | null;
  /** Canales de atención a los que se envió. */
  canales?: string[] | null;
  estado: EstadoCaso;
  /** Solicitud de reapertura pendiente de que un supervisor la resuelva. */
  reaperturaSolicitada?: boolean;
  reaperturaMotivo?: string | null;
  reaperturaSolicitadaPor?: string | null;
  /** Este caso llegó por remisión de otra jurisdicción (otro tenant). */
  remitidoDeTenant?: string | null;
  remitidoDeCasoId?: string | null;
  /** Este caso fue remitido a otra jurisdicción (otro tenant). */
  remitidoATenant?: string | null;
  remitidoACasoId?: string | null;
  creadoPor: string;
  creadoEn: string;
  actualizadoEn: string;
}

/** Instancia del directorio liviano para remitir un caso a otra jurisdicción. */
export interface TenantDirectorio {
  codigo: string;
  nombre: string;
}

/** Formulario de recepción. La agencia de origen la pone el backend con el JWT. */
export interface CrearCaso {
  canal: Canal;
  titulo?: string;
  descripcion?: string;
  ciudadano: string;
  telefono?: string;
  direccionLlamante?: string;
  codigoCaso?: string;
  prioridad?: PrioridadCaso;
  ciudad?: string;
  barrio?: string;
  direccion?: string;
  lat?: number | null;
  lng?: number | null;
  agenciaResponsableId?: string;
  canales?: string[];
  /** Compatibilidad: nombre de agencia en texto (API entrante). */
  agencia?: string;
}

// --- PBX / planta telefónica ---
export type EstadoLlamada = 'sonando' | 'atendida' | 'perdida' | 'finalizada';

export interface Llamada {
  id: string;
  tenant: string;
  callId?: string | null;
  numero: string;
  numeroDestino?: string | null;
  /** Extensión que reportó la central, si ya la enrutó por ACD. */
  extension?: string | null;
  /** Username del funcionario al que el ACD dirigió la llamada; null si es de la cola general. */
  destinatario?: string | null;
  estado: EstadoLlamada;
  casoId?: string | null;
  atendidaPor?: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface PbxConfig {
  /** ¿Ya hay una API key emitida? (En claro solo se guarda su digest.) */
  apiKeyConfigurada: boolean;
  /** El texto claro viaja SOLO en la respuesta de rotar: cópielo ahí mismo. */
  apiKey?: string;
  webhookPath: string;
}

export interface WhatsappConfig {
  phoneNumberId: string | null;
  tokenConfigurado: boolean;
  verifyToken: string;
  webhookPath: string;
  /** A quién se envían los casos que entran por WhatsApp. */
  agenciaResponsableId: string | null;
  canales: string[];
}

export type TipoRecurso = 'patrulla' | 'ambulancia' | 'maquina' | 'moto' | 'otro';
export type EstadoRecurso = 'disponible' | 'asignado' | 'en_ruta' | 'en_sitio' | 'fuera_servicio';

export interface Recurso {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  /** Agencia dueña (agencias.id); sale del catálogo operativo. */
  agenciaId?: string | null;
  /** Nombre de la agencia, denormalizado para listar sin reconsultar. */
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

/** Naturaleza de la agencia; agrupa y da ícono en los tableros. */
export type TipoAgencia = 'policia' | 'bomberos' | 'salud' | 'transito' | 'gestion_riesgo' | 'otra';

/** Entidad que atiende casos dentro del secad (policía, bomberos, salud…). */
export interface Agencia {
  id: string;
  tenant: string;
  codigo: string;
  nombre: string;
  tipo: TipoAgencia;
  telefono?: string | null;
  activo: boolean;
}

/**
 * Canal de atención: la cola de despacho dentro de una agencia. No confundir
 * con el canal de ENTRADA del caso (`Canal`), que es el medio por el que llegó.
 */
export interface CanalAtencion {
  id: string;
  tenant: string;
  agenciaId: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export type PrioridadCaso = 'alta' | 'media' | 'baja';

/** Tipificación del caso: código corto, descripción y prioridad sugerida. */
export interface CodigoCaso {
  id: string;
  tenant: string;
  codigo: string;
  descripcion: string;
  prioridad: PrioridadCaso;
  agenciaSugeridaId?: string | null;
  activo: boolean;
}

/**
 * Desenlace del caso. Es catálogo por secad: la clave queda grabada en el caso
 * cerrado (`Caso.codigoCierre`) y la etiqueta es lo que se muestra y reporta.
 */
export interface CodigoCierre {
  id: string;
  tenant: string;
  codigo: string;
  etiqueta: string;
  activo: boolean;
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
  /** Agencia a la que pertenece el funcionario (agencias.id). */
  agencia?: string | null;
  /** Canales de atención que cubre (canales.id). */
  canales?: string[];
}

export type PlanTenant = 'basico' | 'estandar' | 'avanzado';
export type EstadoSuscripcion = 'prueba' | 'activa' | 'suspendida';

/** Instancia contratada del servicio, con su estado comercial. */
export interface Tenant {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  plan?: PlanTenant;
  suscripcion?: EstadoSuscripcion;
  /** Fecha ISO hasta la que está pagado (aaaa-mm-dd). */
  vence?: string | null;
  motivoBloqueo?: string | null;
  /** Integraciones habilitadas: pbx, whatsapp, api. */
  integraciones?: string[] | null;
  creadoEn?: string;
}

export interface UsuarioAdmin {
  id: string;
  username: string;
  nombre: string;
  rol: Rol;
  tenant: string | null;
  activo: boolean;
  /** Agencia del funcionario y canales de atención que cubre. */
  agenciaId: string | null;
  canales: string[];
  /** Extensión de la planta telefónica; null si no atiende llamadas por PBX. */
  extension: string | null;
}

// --- API entrante (entidades externas) ---
export interface EntidadExterna {
  id: string;
  tenant: string;
  nombre: string;
  agencia: string;
  /** Agencia responsable (agencias.id); null si no se configuró aún. */
  agenciaResponsableId: string | null;
  /** Canales a los que se envían sus casos. */
  canales: string[];
  /** Solo viene (en claro) al crearla o rotarla: es el único momento de copiarla. */
  apiKey?: string;
  activa: boolean;
  creadoEn?: string;
}

// --- RBAC dinámico (roles y permisos por tenant) ---
export interface PermisoDef {
  clave: string;
  etiqueta: string;
  grupo: string;
}

/**
 * Un módulo del sistema: lo que se le asigna a un rol. Al marcarlo, el rol
 * queda con TODOS sus `permisos` (incluidas lecturas transversales, como
 * catálogos) — nunca una funcionalidad suelta del módulo.
 */
export interface ModuloPermisos {
  clave: string;
  etiqueta: string;
  descripcion: string;
  permisos: string[];
}

/** Lo que trae GET /roles/catalogo: módulos para la matriz + catálogo fijo. */
export interface CatalogoRoles {
  modulos: ModuloPermisos[];
  permisos: PermisoDef[];
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
