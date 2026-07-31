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
  { clave: 'casos.gestionar',     etiqueta: 'Gestionar casos (estado, notas, derivar)', grupo: 'Casos' },
  { clave: 'casos.cerrar',        etiqueta: 'Cerrar y reabrir casos',                   grupo: 'Casos' },
  { clave: 'despacho.ver',        etiqueta: 'Ver despacho de recursos',                 grupo: 'Despacho' },
  { clave: 'despacho.asignar',    etiqueta: 'Despachar y mover recursos',               grupo: 'Despacho' },
  { clave: 'recursos.ver',        etiqueta: 'Ver flota de recursos',                    grupo: 'Recursos' },
  { clave: 'recursos.gestionar',  etiqueta: 'Gestionar recursos (alta/edición)',        grupo: 'Recursos' },
  { clave: 'pbx.usar',            etiqueta: 'Atender llamadas (PBX)',                   grupo: 'Integraciones' },
  { clave: 'pbx.configurar',      etiqueta: 'Configurar la planta telefónica',          grupo: 'Integraciones' },
  { clave: 'whatsapp.responder',  etiqueta: 'Responder conversaciones de WhatsApp',     grupo: 'Integraciones' },
  { clave: 'whatsapp.configurar', etiqueta: 'Configurar WhatsApp',                      grupo: 'Integraciones' },
  { clave: 'metricas.ver',        etiqueta: 'Ver el panel de gestión',                  grupo: 'Gestión' },
  { clave: 'usuarios.gestionar',  etiqueta: 'Gestionar usuarios',                       grupo: 'Administración' },
  { clave: 'roles.gestionar',     etiqueta: 'Gestionar roles y permisos',               grupo: 'Administración' },
];

export const CLAVES_PERMISO: string[] = PERMISOS.map((p) => p.clave);

export function esPermisoValido(clave: string): boolean {
  return CLAVES_PERMISO.includes(clave);
}
