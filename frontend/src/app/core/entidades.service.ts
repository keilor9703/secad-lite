import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { EntidadExterna } from './models';

/** Gestión de entidades externas autorizadas en la API entrante. */
@Injectable({ providedIn: 'root' })
export class EntidadesService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/entidades`;

  listar(): Observable<EntidadExterna[]> {
    return this.http.get<EntidadExterna[]>(this.base);
  }

  crear(nombre: string, agenciaResponsableId?: string | null, canales?: string[]): Observable<EntidadExterna> {
    return this.http.post<EntidadExterna>(this.base, { nombre, agenciaResponsableId, canales });
  }

  actualizar(
    id: string,
    cambios: { nombre?: string; agenciaResponsableId?: string | null; canales?: string[]; activa?: boolean },
  ): Observable<EntidadExterna> {
    return this.http.patch<EntidadExterna>(`${this.base}/${id}`, cambios);
  }

  rotar(id: string): Observable<EntidadExterna> {
    return this.http.post<EntidadExterna>(`${this.base}/${id}/rotar`, {});
  }

  /** URL completa del endpoint de radicación, para entregarla a la entidad. */
  endpointUrl(): string {
    return `${environment.apiBaseUrl.replace(/\/api\/?$/, '')}/api/integracion/casos`;
  }
}
