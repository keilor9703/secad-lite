import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Descarga de reportes en CSV desde el backend. */
@Injectable({ providedIn: 'root' })
export class ExportarService {
  private readonly base = `${environment.apiBaseUrl}/metricas`;

  constructor(private http: HttpClient) {}

  /** Descarga casos como CSV y dispara la descarga del archivo en el navegador. */
  descargarCasos(opts?: { desde?: string; hasta?: string; estado?: string }): void {
    let params = new HttpParams();
    if (opts?.desde) params = params.set('desde', opts.desde);
    if (opts?.hasta) params = params.set('hasta', opts.hasta);
    if (opts?.estado) params = params.set('estado', opts.estado);

    this.http.get(`${this.base}/exportar`, { params, responseType: 'blob' }).subscribe({
      next: (blob) => this.descargar(blob, `casos-${this.fechaHoy()}.csv`),
      error: () => {},
    });
  }

  /** Descarga el informe de gestión del período (KPIs, hallazgos, cumplimiento, tiempos, ranking) en PDF. */
  descargarInformePdf(opts?: { desde?: string; hasta?: string }): void {
    let params = new HttpParams();
    if (opts?.desde) params = params.set('desde', opts.desde);
    if (opts?.hasta) params = params.set('hasta', opts.hasta);

    this.http.get(`${this.base}/informe.pdf`, { params, responseType: 'blob' }).subscribe({
      next: (blob) => this.descargar(blob, `informe-${this.fechaHoy()}.pdf`),
      error: () => {},
    });
  }

  private descargar(blob: Blob, nombreArchivo: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private fechaHoy(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
