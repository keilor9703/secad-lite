import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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

/** Punto resuelto de una dirección; `precision` dice cuánto fiarse de él. */
export interface PuntoDireccion {
  lat: number;
  lng: number;
  /** `placa` = portal exacto · `esquina` = la bocacalle · `aproximada` = búsqueda por texto. */
  precision: 'placa' | 'esquina' | 'aproximada';
  etiqueta: string;
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

  /**
   * Dirección colombiana a coordenadas, resuelta en el backend.
   *
   * No se le pregunta a Nominatim desde aquí: no entiende la nomenclatura
   * «Calle 53 # 52-35» —se queda con la vía y devuelve un punto cualquiera de
   * ella, medido a 4,75 km del real en Bogotá—. El backend la resuelve por la
   * esquina de las dos vías y cachea el resultado.
   */
  geocodificar(direccion: string, codigoDane?: string | null): Observable<PuntoDireccion | null> {
    let params = new HttpParams().set('direccion', direccion);
    if (codigoDane) params = params.set('codigoDane', codigoDane);
    return this.http.get<PuntoDireccion | null>(`${this.base}/geografia/geocodificar`, { params });
  }

  /** Coordenadas a dirección con numeración («Calle 53 # 52-35», no solo «Calle 53»). */
  direccionDe(lat: number, lng: number): Observable<{ direccion: string; precision: string } | null> {
    const params = new HttpParams().set('lat', String(lat)).set('lng', String(lng));
    return this.http.get<{ direccion: string; precision: string } | null>(`${this.base}/geografia/direccion`, { params });
  }
}
