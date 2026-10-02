import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/** Dónde estaba el teléfono del llamante al marcar, según el proveedor. */
export interface UbicacionEls {
  lat: number;
  lng: number;
  /** De dónde la tomó el proveedor (p. ej. "CALL"). */
  origen: string | null;
  /** Cuándo se tomó la posición, no cuándo se consultó. */
  momento: string | null;
}

/**
 * Geolocalización automática del llamante (Android ELS).
 *
 * Devuelve `null` ante cualquier contratiempo —sin ubicación, integración
 * apagada, servidor caído— en vez de propagar el error: el operador está
 * atendiendo una emergencia y esto es una ayuda, no un requisito. Si no llega,
 * sigue preguntando la dirección como siempre.
 */
@Injectable({ providedIn: 'root' })
export class ElsService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  ubicacion(telefono: string, caso?: string): Observable<UbicacionEls | null> {
    let params = new HttpParams().set('telefono', telefono);
    if (caso) params = params.set('caso', caso);

    return this.http
      .get<{ hay: boolean; ubicacion?: UbicacionEls }>(`${this.base}/els/ubicacion`, { params })
      .pipe(
        map((r) => (r?.hay && r.ubicacion ? r.ubicacion : null)),
        catchError(() => of(null)),
      );
  }
}
