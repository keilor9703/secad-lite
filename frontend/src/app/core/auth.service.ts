import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Sesion } from './models';

const STORAGE_KEY = 'falconcad_sesion';
const TENANT_KEY = 'falconcad_tenant_ctx';

/**
 * Autenticación de FALCON CAD. Mantiene la sesión en localStorage. El backend
 * emite en el login el rol y sus permisos efectivos (RBAC dinámico); los
 * computed de autorización de la UI se derivan de esos permisos.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly base = environment.apiBaseUrl;

  private readonly _sesion = signal<Sesion | null>(this.leer());
  readonly sesion = this._sesion.asReadonly();
  readonly autenticado = computed(() => this._sesion() !== null);
  /** Puede cerrar / reabrir casos (permiso casos.cerrar). */
  readonly privilegiado = computed(() => this.permiso('casos.cerrar'));
  /** Accede al módulo de administración. */
  readonly esAdmin = computed(() =>
    this.permiso('usuarios.gestionar') || this.permiso('roles.gestionar'),
  );
  readonly esSuperadmin = computed(() => this._sesion()?.rol === 'superadmin');

  /**
   * Tenant que el superadmin tiene "en gestión". Él es global y no pertenece a
   * ninguno, así que elige sobre cuál trabaja; el resto opera siempre en el suyo.
   */
  private readonly _tenantCtx = signal<string>(this.leerTenant());
  readonly tenantCtx = this._tenantCtx.asReadonly();

  /** Tenant efectivo de la sesión (el propio, o el elegido por el superadmin). */
  readonly tenantActivo = computed<string | null>(() => {
    const s = this._sesion();
    if (!s) return null;
    return s.rol === 'superadmin' ? this._tenantCtx() || null : s.tenant;
  });
  /** Puede gestionar roles y permisos. */
  readonly gestionaRoles = computed(() => this.permiso('roles.gestionar'));

  constructor(private http: HttpClient) {}

  /** ¿La sesión actual tiene el permiso? (superadmin los tiene todos). */
  tienePermiso(clave: string): boolean {
    return this.permiso(clave);
  }

  login(usuario: string, contrasena: string): Observable<Sesion> {
    return this.http
      .post<Sesion>(`${this.base}/auth/login`, { usuario, contrasena })
      .pipe(tap((s) => this.guardar(s)));
  }

  loginCivil(usuario: string, contrasena: string): Observable<Sesion> {
    return this.http
      .post<Sesion>(`${this.base}/auth/civil/login`, { usuario, contrasena })
      .pipe(tap((s) => this.guardar(s)));
  }

  /** Cambia el tenant en gestión (solo aplica al superadmin). */
  setTenantCtx(codigo: string): void {
    this._tenantCtx.set(codigo);
    try {
      if (codigo) localStorage.setItem(TENANT_KEY, codigo);
      else localStorage.removeItem(TENANT_KEY);
    } catch { /* almacenamiento no disponible */ }
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.setTenantCtx('');
    this._sesion.set(null);
  }

  get token(): string | null {
    return this._sesion()?.token ?? null;
  }

  private permiso(clave: string): boolean {
    const s = this._sesion();
    if (!s) return false;
    if (s.rol === 'superadmin') return true;
    return (s.permisos ?? []).includes(clave);
  }

  private guardar(s: Sesion): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    this._sesion.set(s);
  }

  private leerTenant(): string {
    try {
      return localStorage.getItem(TENANT_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private leer(): Sesion | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Sesion) : null;
    } catch {
      return null;
    }
  }
}
