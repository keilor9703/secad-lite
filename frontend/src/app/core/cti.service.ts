import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CtiConfig } from './models';

/**
 * Cliente de configuración de la integración CTI/YACO (barra embebida). Solo
 * la parte administrativa (API key + webhook) por ahora — el embebido de la
 * barra en sí y su SSO son un desarrollo aparte, pendiente del contrato final
 * del proveedor.
 */
@Injectable({ providedIn: 'root' })
export class CtiService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  config(): Observable<CtiConfig> {
    return this.http.get<CtiConfig>(`${this.base}/cti/config`);
  }

  rotarKey(): Observable<CtiConfig> {
    return this.http.post<CtiConfig>(`${this.base}/cti/config/rotar`, {});
  }

  /** URL completa del endpoint de eventos, para pegar en la configuración del proveedor. */
  webhookUrl(path: string): string {
    const origin = this.base.replace(/\/api\/?$/, '');
    return `${origin}${path}`;
  }
}
