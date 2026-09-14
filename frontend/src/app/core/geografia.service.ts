import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Departamento {
  codigoDane: string;
  nombre: string;
}

export interface Municipio {
  codigoDane: string;
  departamentoCodigo: string;
  nombre: string;
  subregion: string | null;
}

/** Catálogo de Colombia (DIVIPOLA/DANE) — lectura, igual para todos los tenants. */
@Injectable({ providedIn: 'root' })
export class GeografiaService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Es el mismo catálogo para todos — se pide una sola vez y se reparte, aunque haya varios selectores en pantalla (p. ej. uno por instancia en Plataforma). */
  private readonly departamentos$ = this.http
    .get<Departamento[]>(`${this.base}/geografia/departamentos`)
    .pipe(shareReplay(1));
  private readonly municipiosPorDepto = new Map<string, Observable<Municipio[]>>();

  departamentos(): Observable<Departamento[]> {
    return this.departamentos$;
  }

  /** Centroide del municipio (geocodificado y cacheado en el backend); `null` si no se pudo resolver. */
  centroide(codigoDane: string): Observable<{ lat: number; lng: number } | null> {
    return this.http.get<{ lat: number; lng: number } | null>(`${this.base}/geografia/municipios/${codigoDane}/centroide`);
  }

  municipios(departamentoCodigo: string): Observable<Municipio[]> {
    let obs = this.municipiosPorDepto.get(departamentoCodigo);
    if (!obs) {
      obs = this.http
        .get<Municipio[]>(`${this.base}/geografia/municipios`, { params: { departamento: departamentoCodigo } })
        .pipe(shareReplay(1));
      this.municipiosPorDepto.set(departamentoCodigo, obs);
    }
    return obs;
  }
}
