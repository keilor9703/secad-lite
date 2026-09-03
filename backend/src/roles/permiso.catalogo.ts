/**
 * Catálogo FIJO de permisos (capacidades) que la app sabe verificar. Los roles
 * son dinámicos y se arman marcando permisos de este catálogo (la matriz de la
 * UI). Un permiso nuevo debe corresponder a una verificación real en el código.
 */
export interface PermisoDef {
  clave: string;
  etiqueta: string;
  grupo: string;
}

export const PERMISOS: PermisoDef[] = [
  { clave: 'casos.ver',           etiqueta: 'Ver casos (bandeja y detalle)',            grupo: 'Casos' },
  { clave: 'casos.crear',         etiqueta: 'Recepcionar casos',                        grupo: 'Casos' },
  { clave: 'casos.ver_todos',     etiqueta: 'Ver todos los casos del secad (supervisión)', grupo: 'Casos' },
  { clave: 'casos.gestionar',     etiqueta: 'Gestionar casos (estado, notas, derivar)', grupo: 'Casos' },
  { clave: 'casos.cerrar',        etiqueta: 'Cerrar casos',                             grupo: 'Casos' },
  { clave: 'casos.reabrir',       etiqueta: 'Autorizar la reapertura de un caso cerrado', grupo: 'Casos' },
  { clave: 'casos.remitir_tenant', etiqueta: 'Remitir casos a otra jurisdicción (otro tenant)', grupo: 'Casos' },
  { clave: 'casos.ver_grabaciones', etiqueta: 'Ver grabaciones y transcripciones de llamadas', grupo: 'Casos' },
  { clave: 'despacho.ver',        etiqueta: 'Ver despacho de recursos',                 grupo: 'Despacho' },
  { clave: 'despacho.asignar',    etiqueta: 'Despachar y mover recursos',               grupo: 'Despacho' },
  { clave: 'recursos.ver',        etiqueta: 'Ver flota de recursos',                    grupo: 'Recursos' },
  { clave: 'recursos.gestionar',  etiqueta: 'Gestionar recursos (alta/edición)',        grupo: 'Recursos' },
  { clave: 'pbx.usar',            etiqueta: 'Atender llamadas (PBX)',                   grupo: 'Integraciones' },
  { clave: 'pbx.configurar',      etiqueta: 'Configurar la planta telefónica',          grupo: 'Integraciones' },
  { clave: 'whatsapp.responder',  etiqueta: 'Responder conversaciones de WhatsApp',     grupo: 'Integraciones' },
  { clave: 'whatsapp.configurar', etiqueta: 'Configurar WhatsApp',                      grupo: 'Integraciones' },
  { clave: 'entidades.gestionar', etiqueta: 'Gestionar entidades externas (API)',      grupo: 'Integraciones' },
  { clave: 'cti.configurar',      etiqueta: 'Configurar la integración CTI/YACO',       grupo: 'Integraciones' },
  { clave: 'metricas.ver',        etiqueta: 'Ver el panel de gestión',                  grupo: 'Gestión' },
  { clave: 'catalogos.gestionar', etiqueta: 'Gestionar agencias, canales y códigos', grupo: 'Administración' },
  { clave: 'usuarios.gestionar',  etiqueta: 'Gestionar usuarios',                       grupo: 'Administración' },
  { clave: 'roles.gestionar',     etiqueta: 'Gestionar roles y permisos',               grupo: 'Administración' },
];

export const CLAVES_PERMISO: string[] = PERMISOS.map((p) => p.clave);

export function esPermisoValido(clave: string): boolean {
  return CLAVES_PERMISO.includes(clave);
}

/**
 * Un módulo, no una funcionalidad suelta, es lo que se le asigna a un rol: al
 * marcar "Recepción" para el rol operador, ese rol debe quedar con TODO lo que
 * Recepción necesita para funcionar completa —incluida la lectura de
 * catálogos (agencias/canales/códigos), que es un permiso propio pero
 * transversal a varios módulos—, no solo "crear casos" suelto. Marcar un
 * módulo agrega su lista de permisos; desmarcarlo la quita, salvo lo que otro
 * módulo YA marcado del mismo rol siga necesitando (la UI de Administración
 * hace ese cálculo, ver `admin.ts`).
 *
 * Las funcionalidades genuinamente transversales —que no pertenecen a un solo
 * módulo, sino que se añaden encima de cualquiera de ellos— no están aquí:
 * siguen siendo permisos sueltos (ver `CLAVES_TRANSVERSALES`).
 */
export interface ModuloPermisos {
  clave: string;
  etiqueta: string;
  descripcion: string;
  permisos: string[];
}

export const MODULOS: ModuloPermisos[] = [
  {
    clave: 'recepcion', etiqueta: 'Recepción',
    descripcion: 'Recepcionar casos multicanal y remitirlos a los canales de despacho.',
    permisos: ['casos.ver', 'casos.crear'],
  },
  {
    clave: 'despacho', etiqueta: 'Despacho',
    descripcion: 'Gestionar los casos que llegan a sus canales: tomarlos, cerrarlos, asignar y mover recursos.',
    permisos: [
      'casos.ver', 'casos.gestionar', 'casos.cerrar', 'casos.remitir_tenant',
      'despacho.ver', 'despacho.asignar', 'recursos.ver', 'casos.ver_grabaciones',
    ],
  },
  {
    clave: 'consulta', etiqueta: 'Consulta',
    descripcion: 'Ver el histórico completo del secad (no solo lo propio) y autorizar reaperturas.',
    permisos: ['casos.ver', 'casos.ver_todos', 'casos.reabrir', 'casos.ver_grabaciones'],
  },
  {
    clave: 'recursos', etiqueta: 'Recursos',
    descripcion: 'Dar de alta y editar la flota de recursos/unidades del secad.',
    permisos: ['recursos.ver', 'recursos.gestionar'],
  },
  {
    clave: 'panel', etiqueta: 'Panel de gestión y Mapa',
    descripcion: 'Ver las métricas de casos por estado, canal y agencia, y el mapa estadístico y de calor por ubicación.',
    permisos: ['metricas.ver'],
  },
  {
    clave: 'catalogos', etiqueta: 'Catálogos',
    descripcion: 'Editar agencias, canales de atención y códigos de caso/cierre.',
    permisos: ['casos.ver', 'catalogos.gestionar'],
  },
  {
    clave: 'administracion', etiqueta: 'Administración',
    descripcion: 'Gestionar usuarios y roles, y configurar PBX, WhatsApp, CTI/YACO y entidades externas.',
    permisos: [
      'usuarios.gestionar', 'roles.gestionar', 'catalogos.gestionar',
      'pbx.configurar', 'whatsapp.configurar', 'entidades.gestionar', 'cti.configurar',
    ],
  },
];

/**
 * Capacidades que cruzan varios módulos en vez de pertenecer a uno: atender
 * llamadas o responder WhatsApp tiene sentido tanto para quien solo recepciona
 * como para quien además despacha. Se marcan aparte de los módulos.
 */
export const CLAVES_TRANSVERSALES: string[] = ['pbx.usar', 'whatsapp.responder'];
