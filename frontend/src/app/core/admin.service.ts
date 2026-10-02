import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Tenant, UsuarioAdmin } from './models';

export interface CrearUsuario {
  username: string;
  nombre: string;
  contrasena: string;
  /** Código del rol (dinámico por tenant). */
  rol: string;
  tenant?: string;
  /** Agencia a la que se adscribe (agencias.id). */
  agenciaId?: string | null;
  /** Canales de atención que cubrirá, todos de esa agencia. */
  canales?: string[];
  /** Extensión de la planta telefónica (única por secad). */
  extension?: string | null;
}

/** Entrada de la bitácora de administración: quién cambió qué. */
export interface EntradaBitacora {
  id: string;
  tenant: string;
  autor: string;
  accion: string;
  detalle: string;
  creadoEn: string;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  // Tenants (solo superadmin)
  listarTenants(): Observable<Tenant[]> {
    return this.http.get<Tenant[]>(`${this.base}/tenants`);
  }
  /** Suscripción, bloqueo e integraciones (solo el dueño de la plataforma). */
  actualizarTenant(id: string, cambios: Partial<Tenant>): Observable<Tenant> {
    return this.http.patch<Tenant>(`${this.base}/tenants/${id}`, cambios);
  }
  /** `codigoDane` es el del MUNICIPIO (5 dígitos, elegido de la lista) — departamento/municipio/subregión los deriva el backend. */
  crearTenant(dto: { codigo: string; nombre: string; codigoDane?: string }): Observable<Tenant> {
    return this.http.post<Tenant>(`${this.base}/tenants`, dto);
  }

  /**
   * Quita el enrolamiento del doble factor de una cuenta. El usuario verá otra
   * vez el código QR en su siguiente ingreso.
   */
  restablecerMfaUsuario(id: string): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(`${this.base}/usuarios/${id}/mfa/restablecer`, {});
  }

  // Usuarios (permiso usuarios.gestionar)
  listarUsuarios(): Observable<UsuarioAdmin[]> {
    return this.http.get<UsuarioAdmin[]>(`${this.base}/usuarios`);
  }
  crearUsuario(dto: CrearUsuario): Observable<UsuarioAdmin> {
    return this.http.post<UsuarioAdmin>(`${this.base}/usuarios`, dto);
  }
  /** Validación en vivo del formulario de alta: ¿ese username ya existe en algún tenant? */
  usernameDisponible(username: string): Observable<{ disponible: boolean }> {
    return this.http.get<{ disponible: boolean }>(`${this.base}/usuarios/disponible`, { params: { username } });
  }
  cambiarActivo(id: string, activo: boolean): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { activo });
  }
  cambiarAdscripcion(id: string, agenciaId: string | null, canales: string[]): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { agenciaId, canales });
  }
  /** Nombre, agencia y canales en un solo PATCH — la edición completa de una cuenta ya creada. */
  editarUsuario(id: string, cambios: { nombre?: string; agenciaId?: string | null; canales?: string[] }): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, cambios);
  }
  cambiarRol(id: string, rol: string): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { rol });
  }
  /** Extensión de la PBX; null la retira (deja de recibir llamadas dirigidas). */
  cambiarExtension(id: string, extension: string | null): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { extension });
  }
  /**
   * Cambia la contraseña de cualquier usuario visible en la tabla —incluida
   * la del propio superadmin, cuando es él quien mira—: el backend ya
   * resuelve el alcance (un admin de tenant solo ve y puede tocar los suyos).
   */
  /** Bitácora de administración: quién cambió qué en la configuración. */
  listarBitacora(limite = 100): Observable<EntradaBitacora[]> {
    return this.http.get<EntradaBitacora[]>(`${environment.apiBaseUrl}/admin/bitacora?limite=${limite}`);
  }

  cambiarContrasena(id: string, contrasena: string): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { contrasena });
  }

  // --- Config SMS global (solo superadmin desde Plataforma) ---
  verConfigSms(): Observable<ConfigSmsVisible> {
    return this.http.get<ConfigSmsVisible>(`${this.base}/plataforma/sms`);
  }
  guardarConfigSms(datos: Partial<ConfigSmsGuardar>): Observable<ConfigSmsVisible> {
    return this.http.post<ConfigSmsVisible>(`${this.base}/plataforma/sms`, datos);
  }
  probarSms(numero: string): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(`${this.base}/plataforma/sms/probar`, { numero });
  }

  // --- Config de geolocalización ELS global (solo superadmin desde Plataforma) ---
  verConfigEls(): Observable<ConfigElsVisible> {
    return this.http.get<ConfigElsVisible>(`${this.base}/plataforma/els`);
  }
  guardarConfigEls(datos: Partial<ConfigElsGuardar>): Observable<ConfigElsVisible> {
    return this.http.post<ConfigElsVisible>(`${this.base}/plataforma/els`, datos);
  }
  probarEls(telefono: string): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.post<{ ok: boolean; mensaje: string }>(`${this.base}/plataforma/els/probar`, { telefono });
  }

  // --- Política de doble factor (solo superadmin desde Plataforma) ---
  verConfigMfa(): Observable<ConfigMfaVisible> {
    return this.http.get<ConfigMfaVisible>(`${this.base}/plataforma/mfa`);
  }
  guardarConfigMfa(exigido: boolean): Observable<ConfigMfaVisible> {
    return this.http.post<ConfigMfaVisible>(`${this.base}/plataforma/mfa`, { exigido });
  }
}

export interface ConfigSmsVisible {
  proveedor: 'INFOBIP' | 'INALAMBRIA_EXPRESS';
  baseUrl: string | null;
  sender: string | null;
  activo: boolean;
  tieneApiKey: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}
export interface ConfigSmsGuardar {
  proveedor?: 'INFOBIP' | 'INALAMBRIA_EXPRESS';
  apiKey?: string;
  baseUrl?: string | null;
  sender?: string | null;
  activo?: boolean;
}

/** Configuración del proveedor de geolocalización ELS; el secreto nunca viaja. */
export interface ConfigElsVisible {
  baseUrl: string | null;
  agencia: string | null;
  clienteId: string | null;
  casoPorDefecto: string | null;
  activo: boolean;
  tieneSecreto: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}
export interface ConfigElsGuardar {
  baseUrl?: string | null;
  agencia?: string | null;
  clienteId?: string | null;
  clienteSecreto?: string;
  casoPorDefecto?: string | null;
  activo?: boolean;
}

/** Política de doble factor de la plataforma. */
export interface ConfigMfaVisible {
  exigido: boolean;
  /**
   * El entorno lo apagó con MFA_OBLIGATORIO=false. Cuando es true, el
   * interruptor de la pantalla no manda — y hay que decirlo, o el
   * administrador vería «exigido» sin entender por qué nadie lo pide.
   */
  forzadoPorEntorno: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}
