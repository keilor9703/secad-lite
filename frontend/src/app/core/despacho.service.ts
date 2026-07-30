import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Asignacion, EstadoAsignacion, Recurso, RecursoSugerido, TipoRecurso } from './models';

export interface CrearRecurso {
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  agencia?: string;
}

@Injectable({ providedIn: 'root' })
export class DespachoService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  // Flota
  listarRecursos(): Observable<Recurso[]> {
    return this.http.get<Recurso[]>(`${this.base}/recursos`);
  }
  disponibles(): Observable<Recurso[]> {
    return this.http.get<Recurso[]>(`${this.base}/recursos/disponibles`);
  }
  crearRecurso(dto: CrearRecurso): Observable<Recurso> {
    return this.http.post<Recurso>(`${this.base}/recursos`, dto);
  }
  fueraServicio(id: string, fueraServicio: boolean): Observable<Recurso> {
    return this.http.patch<Recurso>(`${this.base}/recursos/${id}`, { fueraServicio });
  }

  // Despacho sobre un caso
  asignaciones(casoId: string): Observable<Asignacion[]> {
    return this.http.get<Asignacion[]>(`${this.base}/casos/${casoId}/asignaciones`);
  }
  /** Recursos disponibles ordenados por cercanía al caso (distancia + ETA). */
  recursosSugeridos(casoId: string): Observable<RecursoSugerido[]> {
    return this.http.get<RecursoSugerido[]>(`${this.base}/casos/${casoId}/recursos-sugeridos`);
  }
  despachar(casoId: string, recursoId: string): Observable<Asignacion> {
    return this.http.post<Asignacion>(`${this.base}/casos/${casoId}/asignaciones`, { recursoId });
  }
  cambiarEstado(asignacionId: string, estado: EstadoAsignacion, motivo?: string): Observable<Asignacion> {
    return this.http.patch<Asignacion>(`${this.base}/asignaciones/${asignacionId}/estado`, { estado, motivo });
  }
}
