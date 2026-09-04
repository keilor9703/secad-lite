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

/** Mismos totales del período inmediatamente anterior (misma duración, sin solaparse), para medir variación. */
export interface ResumenPeriodoAnterior {
  total: number;
  tiempoTomaProm: number | null;
}

export interface Resumen {
  /** Rango efectivamente usado (aaaa-mm-dd, ambos inclusive) — últimos 30 días si no se pide otro. */
  periodo: { desde: string; hasta: string };
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
  tiempos: { porPrioridad: TiemposPrioridad[]; global: TiemposPrioridad | null };
  periodoAnterior: ResumenPeriodoAnterior;
}

export interface FiltroResumen {
  desde?: string;
  hasta?: string;
}

export interface PuntoTendencia {
  fecha: string;
  total: number;
}

/** Serie diaria de casos del período, junto con la misma serie del período anterior para superponer en un gráfico. */
export interface Tendencia {
  periodo: { desde: string; hasta: string };
  actual: PuntoTendencia[];
  anterior: PuntoTendencia[];
}

export interface CumplimientoPrioridad {
  prioridad: string;
  metaMin: number;
  totalDespachados: number;
  dentroDeMeta: number;
  porcentaje: number | null;
}

/** Cumplimiento de la meta de despacho por prioridad, para el período. */
export interface Cumplimiento {
  periodo: { desde: string; hasta: string };
  porPrioridad: CumplimientoPrioridad[];
}

export interface Hallazgo {
  severidad: 'info' | 'atencion' | 'critico';
  titulo: string;
  detalle: string;
}

/** Lectura automática de resumen/cumplimiento/tendencia del período — reglas simples, no aprendizaje automático. */
export interface Hallazgos {
  periodo: { desde: string; hasta: string };
  items: Hallazgo[];
}

export interface RankingOperador {
  autor: string;
  casosTomados: number;
  casosCerrados: number;
}

/** Quién gestionó qué, según la bitácora de casos_eventos del período. Ordenado por casos tomados. */
export interface Ranking {
  periodo: { desde: string; hasta: string };
  operadores: RankingOperador[];
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

  resumen(filtro?: FiltroResumen): Observable<Resumen> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    return this.http.get<Resumen>(this.base, { params });
  }

  tendencia(filtro?: FiltroResumen): Observable<Tendencia> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    return this.http.get<Tendencia>(`${this.base}/tendencia`, { params });
  }

  cumplimiento(filtro?: FiltroResumen): Observable<Cumplimiento> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    return this.http.get<Cumplimiento>(`${this.base}/cumplimiento`, { params });
  }

  hallazgos(filtro?: FiltroResumen): Observable<Hallazgos> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    return this.http.get<Hallazgos>(`${this.base}/hallazgos`, { params });
  }

  ranking(filtro?: FiltroResumen): Observable<Ranking> {
    let params = new HttpParams();
    if (filtro?.desde) params = params.set('desde', filtro.desde);
    if (filtro?.hasta) params = params.set('hasta', filtro.hasta);
    return this.http.get<Ranking>(`${this.base}/ranking`, { params });
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
