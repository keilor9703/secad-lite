import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Caso, CrearCaso, EstadoCaso } from './models';

/** Acceso a la bandeja de recepción (casos) del backend. */
@Injectable({ providedIn: 'root' })
export class CasosService {
  private readonly base = `${environment.apiBaseUrl}/casos`;

  constructor(private http: HttpClient) {}

  listar(): Observable<Caso[]> {
    return this.http.get<Caso[]>(this.base);
  }

  crear(dto: CrearCaso): Observable<Caso> {
    return this.http.post<Caso>(this.base, dto);
  }

  cambiarEstado(id: string, estado: EstadoCaso, agencia?: string): Observable<Caso> {
    return this.http.patch<Caso>(`${this.base}/${id}/estado`, { estado, agencia });
  }
}
