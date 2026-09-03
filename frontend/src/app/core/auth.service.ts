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

  /**
   * ¿SU tenant tiene esta integración contratada? Sirve para no pedir la
   * configuración de un módulo que el municipio no compró (y toparse con el
   * aviso de "no habilitado" en cada carga). Solo tiene sentido para la
   * sesión de un tenant: el superadmin no pertenece a ninguno fijo — en las
   * vistas donde él elige un tenant, se resuelve aparte con la lista que ya
   * tiene cargada, no con esto.
   */
  tieneIntegracion(clave: string): boolean {
    const s = this._sesion();
    if (!s || s.rol === 'superadmin') return true;
    return (s.integraciones ?? []).includes(clave);
  }

  /**
   * Trae del servidor el rol, los permisos, la agencia y los canales vigentes y
   * los aplica a la sesión guardada. Los del token quedaron congelados al
   * iniciar sesión: sin esto, un permiso retirado seguiría pintando su módulo.
   */
  refrescarPerfil(): void {
    if (!this._sesion()) return;
    this.http.get<Partial<Sesion> & { permisos: string[]; canales: string[]; integraciones: string[] }>(`${this.base}/auth/perfil`).subscribe({
      next: (p) => {
        const actual = this._sesion();
        if (!actual) return;
        const fresca: Sesion = {
          ...actual, rol: p.rol ?? actual.rol, permisos: p.permisos,
          agencia: p.agencia ?? null, canales: p.canales ?? [], integraciones: p.integraciones ?? [],
        };
        this._sesion.set(fresca);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fresca)); } catch { /* sin almacenamiento */ }
      },
      // Si la cuenta fue desactivada, el interceptor ya devolverá 401 en el resto.
      error: () => {},
    });
  }

  /** Autoservicio: cambia MI contraseña demostrando la actual. */
  cambiarContrasena(actual: string, nueva: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/auth/cambiar-contrasena`, { actual, nueva });
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
