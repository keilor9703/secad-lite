import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PermisoDef, RolTenant } from './models';

/**
 * Gestión de roles y permisos del tenant (RBAC dinámico). El tenant lo resuelve
 * el backend a partir de la sesión y del tenant en gestión (header X-Tenant-Id
 * que pone el interceptor), así que aquí no viaja ningún parámetro extra.
 */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/roles`;

  /** Catálogo fijo de permisos (filas de la matriz). */
  catalogo(): Observable<PermisoDef[]> {
    return this.http.get<PermisoDef[]>(`${this.base}/catalogo`);
  }

  listar(): Observable<RolTenant[]> {
    return this.http.get<RolTenant[]>(this.base);
  }

  crear(nombre: string, permisos: string[]): Observable<RolTenant> {
    return this.http.post<RolTenant>(this.base, { nombre, permisos });
  }

  actualizar(id: string, cambios: { nombre?: string; permisos?: string[] }): Observable<RolTenant> {
    return this.http.patch<RolTenant>(`${this.base}/${id}`, cambios);
  }

  eliminar(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${id}`);
  }
}
