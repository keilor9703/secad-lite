import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Resumen {
  total: number;
  porEstado: Record<string, number>;
  porCanal: Record<string, number>;
  porAgencia: Array<{ agencia: string; total: number }>;
}

@Injectable({ providedIn: 'root' })
export class MetricasService {
  private http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/metricas`;

  resumen(): Observable<Resumen> {
    return this.http.get<Resumen>(this.base);
  }
}
