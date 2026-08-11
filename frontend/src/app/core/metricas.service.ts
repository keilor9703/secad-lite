import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Tiempos promedio (minutos) desde la recepción, últimos 30 días. */
export interface TiemposPrioridad {
  prioridad: string;
  total: number;
  tomaMin: number | null;
  despachoMin: number | null;
  cierreMin: number | null;
}

export interface Resumen {
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
  tiempos: { porPrioridad: TiemposPrioridad[]; global: TiemposPrioridad | null };
}

/** Un caso histórico con ubicación, para pintar en el mapa (puntos/cluster/calor). */
export interface PuntoMapa {
  id: string;
  lat: number;
  lng: number;
  codigoCaso: string | null;
  prioridad: string;
  titulo: string;
  creadoEn: string;
}

export interface AnalisisMapa {
  puntos: PuntoMapa[];
  totalConUbicacion: number;
  totalSinUbicacion: number;
  /** Día de la semana (0 = domingo … 6 = sábado). */
  porDiaSemana: Array<{ dia: number; total: number }>;
  /** Hora del día (0-23). */
  porHora: Array<{ hora: number; total: number }>;
  topCodigos: Array<{ codigo: string; descripcion: string | null; total: number }>;
}

export interface FiltroMapa {
  desde?: string;
  hasta?: string;
  codigo?: string;
}

/** Reporte de la planta telefónica (PBX), últimos 30 días. */
export interface ResumenLlamadas {
  total: number;
  porEstado: Record<string, number>;
  /** Minutos promedio entre que timbra y que se atiende; null sin llamadas atendidas en el período. */
  tiempoRespuestaProm: number | null;
}

@Injectable({ providedIn: 'root' })
export class MetricasService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/metricas`;

  resumen(): Observable<Resumen> {
    return this.http.get<Resumen>(this.base);
  }

  mapa(filtro?: FiltroMapa): Observable<AnalisisMapa> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    if (filtro?.codigo) params = params.set('codigo', filtro.codigo);
    return this.http.get<AnalisisMapa>(`${this.base}/mapa`, { params });
  }

  llamadas(): Observable<ResumenLlamadas> {
    return this.http.get<ResumenLlamadas>(`${this.base}/llamadas`);
  }
}
