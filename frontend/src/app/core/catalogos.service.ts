import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Agencia, CanalAtencion, CodigoCaso, CodigoCierre, PrioridadCaso, TipoAgencia } from './models';

/** Una fila que la importación no pudo aceptar, con su línea en el archivo. */
export interface FilaRechazada {
  linea: number;
  codigo: string;
  motivo: string;
}

/** Lo que devuelve una carga masiva de códigos de caso. */
export interface ResultadoImportacion {
  leidas: number;
  creados: number;
  actualizados: number;
  omitidos: number;
  rechazos: FilaRechazada[];
  simulacion: boolean;
}

/**
 * Catálogos operativos del secad: agencias, sus canales de atención, los
 * códigos de caso y los de cierre. El tenant lo resuelve el backend a partir
 * de la sesión.
 */
@Injectable({ providedIn: 'root' })
export class CatalogosService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/catalogos`;

  // --- Agencias ---------------------------------------------------------------

  agencias(soloActivas = false): Observable<Agencia[]> {
    const q = soloActivas ? '?activas=true' : '';
    return this.http.get<Agencia[]>(`${this.base}/agencias${q}`);
  }

  crearAgencia(dto: { codigo: string; nombre: string; tipo?: TipoAgencia; telefono?: string }): Observable<Agencia> {
    return this.http.post<Agencia>(`${this.base}/agencias`, dto);
  }

  actualizarAgencia(
    id: string,
    cambios: { codigo?: string; nombre?: string; tipo?: TipoAgencia; telefono?: string; activo?: boolean },
  ): Observable<Agencia> {
    return this.http.patch<Agencia>(`${this.base}/agencias/${id}`, cambios);
  }

  /** Borrado definitivo; el backend lo impide si la agencia ya tiene historia. */
  eliminarAgencia(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/agencias/${id}/definitivo`);
  }

  // --- Canales de atención ----------------------------------------------------

  canales(agenciaId?: string, soloActivos = false): Observable<CanalAtencion[]> {
    const q = new URLSearchParams();
    if (agenciaId) q.set('agencia', agenciaId);
    if (soloActivos) q.set('activos', 'true');
    const cola = q.toString();
    return this.http.get<CanalAtencion[]>(`${this.base}/canales${cola ? '?' + cola : ''}`);
  }

  crearCanal(dto: { agenciaId: string; codigo: string; nombre: string }): Observable<CanalAtencion> {
    return this.http.post<CanalAtencion>(`${this.base}/canales`, dto);
  }

  actualizarCanal(
    id: string,
    cambios: { codigo?: string; nombre?: string; activo?: boolean },
  ): Observable<CanalAtencion> {
    return this.http.patch<CanalAtencion>(`${this.base}/canales/${id}`, cambios);
  }

  eliminarCanal(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/canales/${id}/definitivo`);
  }

  // --- Códigos de caso --------------------------------------------------------

  codigos(soloActivos = false): Observable<CodigoCaso[]> {
    const q = soloActivos ? '?activos=true' : '';
    return this.http.get<CodigoCaso[]>(`${this.base}/codigos-caso${q}`);
  }

  crearCodigo(dto: { codigo: string; descripcion: string; prioridad?: PrioridadCaso; agenciaSugeridaId?: string | null }): Observable<CodigoCaso> {
    return this.http.post<CodigoCaso>(`${this.base}/codigos-caso`, dto);
  }

  actualizarCodigo(id: string, cambios: { codigo?: string; descripcion?: string; prioridad?: PrioridadCaso; agenciaSugeridaId?: string | null; activo?: boolean }): Observable<CodigoCaso> {
    return this.http.patch<CodigoCaso>(`${this.base}/codigos-caso/${id}`, cambios);
  }

  eliminarCodigo(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/codigos-caso/${id}/definitivo`);
  }

  // --- Carga y descarga del catálogo de códigos de caso -----------------------

  /** Descarga como texto; el componente arma el archivo para el navegador. */
  descargarPlantillaCodigos(): Observable<string> {
    return this.http.get(`${this.base}/codigos-caso/exportar/plantilla`, { responseType: 'text' });
  }

  exportarCodigos(): Observable<string> {
    return this.http.get(`${this.base}/codigos-caso/exportar/datos`, { responseType: 'text' });
  }

  importarCodigos(
    csv: string,
    opciones: { existentes?: 'omitir' | 'actualizar'; simulacion?: boolean } = {},
  ): Observable<ResultadoImportacion> {
    return this.http.post<ResultadoImportacion>(`${this.base}/codigos-caso/importar`, { csv, ...opciones });
  }

  // --- Códigos de cierre ------------------------------------------------------

  cierres(soloActivos = false): Observable<CodigoCierre[]> {
    const q = soloActivos ? '?activos=true' : '';
    return this.http.get<CodigoCierre[]>(`${this.base}/codigos-cierre${q}`);
  }

  crearCierre(dto: { codigo: string; etiqueta: string }): Observable<CodigoCierre> {
    return this.http.post<CodigoCierre>(`${this.base}/codigos-cierre`, dto);
  }

  actualizarCierre(
    id: string,
    cambios: { codigo?: string; etiqueta?: string; activo?: boolean },
  ): Observable<CodigoCierre> {
    return this.http.patch<CodigoCierre>(`${this.base}/codigos-cierre/${id}`, cambios);
  }

  eliminarCierre(id: string): Observable<{ ok: true }> {
    return this.http.delete<{ ok: true }>(`${this.base}/codigos-cierre/${id}/definitivo`);
  }
}
