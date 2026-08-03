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
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  // Tenants (solo superadmin)
  listarTenants(): Observable<Tenant[]> {
    return this.http.get<Tenant[]>(`${this.base}/tenants`);
  }
  crearTenant(codigo: string, nombre: string): Observable<Tenant> {
    return this.http.post<Tenant>(`${this.base}/tenants`, { codigo, nombre });
  }

  // Usuarios (permiso usuarios.gestionar)
  listarUsuarios(): Observable<UsuarioAdmin[]> {
    return this.http.get<UsuarioAdmin[]>(`${this.base}/usuarios`);
  }
  crearUsuario(dto: CrearUsuario): Observable<UsuarioAdmin> {
    return this.http.post<UsuarioAdmin>(`${this.base}/usuarios`, dto);
  }
  cambiarActivo(id: string, activo: boolean): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { activo });
  }
  cambiarRol(id: string, rol: string): Observable<UsuarioAdmin> {
    return this.http.patch<UsuarioAdmin>(`${this.base}/usuarios/${id}`, { rol });
  }
}
