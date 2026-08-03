import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PermisoDef, RolTenant } from './models';

/**
 * Gestión de roles y permisos del tenant (RBAC dinámico). El `tenant` solo lo
 * envía el superadmin (que no pertenece a ninguno y elige sobre cuál trabaja);
 * para el resto el backend usa el del token y lo ignora.
 */
@Injectable({ providedIn: 'root' })
export class RolesService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/roles`;

  /** Catálogo fijo de permisos (filas de la matriz). */
  catalogo(): Observable<PermisoDef[]> {
    return this.http.get<PermisoDef[]>(`${this.base}/catalogo`);
  }

  listar(tenant?: string): Observable<RolTenant[]> {
    return this.http.get<RolTenant[]>(this.base, this.opts(tenant));
  }

  crear(nombre: string, permisos: string[], tenant?: string): Observable<RolTenant> {
    return this.http.post<RolTenant>(this.base, { nombre, permisos }, this.opts(tenant));
  }

  actualizar(id: string, cambios: { nombre?: string; permisos?: string[] }, tenant?: string): Observable<RolTenant> {
    return this.http.patch<RolTenant>(`${this.base}/${id}`, cambios, this.opts(tenant));
  }

  eliminar(id: string, tenant?: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/${id}`, this.opts(tenant));
  }

  private opts(tenant?: string): { params?: HttpParams } {
    return tenant ? { params: new HttpParams().set('tenant', tenant) } : {};
  }
}
