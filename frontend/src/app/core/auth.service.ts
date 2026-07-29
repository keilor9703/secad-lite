import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Sesion } from './models';

const STORAGE_KEY = 'falconcad_sesion';

/**
 * Autenticación del FALCON CAD. Mantiene la sesión en localStorage y expone dos
 * flujos: `login` (usuario del sistema) y `loginCivil` (ciudadano, para el chat).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly base = environment.apiBaseUrl;

  private readonly _sesion = signal<Sesion | null>(this.leer());
  readonly sesion = this._sesion.asReadonly();
  readonly autenticado = computed(() => this._sesion() !== null);
  /** Supervisor o admin: puede cerrar / reabrir casos. */
  readonly privilegiado = computed(() => {
    const r = this._sesion()?.rol;
    return r === 'supervisor' || r === 'admin' || r === 'superadmin';
  });
  /** Admin o superadmin: accede al módulo de administración. */
  readonly esAdmin = computed(() => {
    const r = this._sesion()?.rol;
    return r === 'admin' || r === 'superadmin';
  });
  readonly esSuperadmin = computed(() => this._sesion()?.rol === 'superadmin');

  constructor(private http: HttpClient) {}

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

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    this._sesion.set(null);
  }

  get token(): string | null {
    return this._sesion()?.token ?? null;
  }

  private guardar(s: Sesion): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    this._sesion.set(s);
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
