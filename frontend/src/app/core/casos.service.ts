import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Caso, CrearCaso, EstadoCaso, EventoCaso } from './models';

/** Acceso a la bandeja de recepción (casos) del backend. */
@Injectable({ providedIn: 'root' })
export class CasosService {
  private readonly base = `${environment.apiBaseUrl}/casos`;

  constructor(private http: HttpClient) {}

  /**
   * Bandeja del secad, acotada en el servidor: `limite` casos recientes (200
   * por defecto, tope 500) y, con `abiertos`, solo los no cerrados — lo que
   * necesita el tablero, sin arrastrar meses de historial en cada refresco.
   */
  listar(opts?: { limite?: number; abiertos?: boolean; desde?: string; hasta?: string }): Observable<Caso[]> {
    let params = new HttpParams();
    if (opts?.limite) params = params.set('limite', String(opts.limite));
    if (opts?.abiertos) params = params.set('abiertos', 'true');
    if (opts?.desde) params = params.set('desde', opts.desde);
    if (opts?.hasta) params = params.set('hasta', opts.hasta);
    return this.http.get<Caso[]>(this.base, { params });
  }

  /** Deja constancia de que un caso cerrado debe reabrirse. */
  solicitarReapertura(id: string, motivo: string): Observable<Caso> {
    return this.http.post<Caso>(`${this.base}/${id}/reapertura/solicitar`, { motivo });
  }

  /** Reapertura autorizada; la observación queda en la trazabilidad. */
  reabrir(id: string, motivo: string, estado: EstadoCaso = 'en_gestion'): Observable<Caso> {
    return this.http.post<Caso>(`${this.base}/${id}/reapertura`, { motivo, estado });
  }

  /** Remite el caso a canales de otra agencia (sumando o trasladando). */
  remitir(id: string, dto: {
    agenciaResponsableId?: string;
    canales: string[];
    observacion?: string;
    exclusivo?: boolean;
  }): Observable<Caso> {
    return this.http.post<Caso>(`${this.base}/${id}/remitir`, dto);
  }

  crear(dto: CrearCaso): Observable<Caso> {
    return this.http.post<Caso>(this.base, dto);
  }

  cambiarEstado(id: string, estado: EstadoCaso, agencia?: string): Observable<Caso> {
    return this.http.patch<Caso>(`${this.base}/${id}/estado`, { estado, agencia });
  }

  /** Cierra clasificando: el código y el comentario alimentan los reportes. */
  cerrar(id: string, codigoCierre: string, comentario: string): Observable<Caso> {
    return this.http.patch<Caso>(`${this.base}/${id}/estado`, { estado: 'cerrado', codigoCierre, comentario });
  }

  /** Se hace cargo del caso: si estaba nuevo, pasa a gestión. */
  tomar(id: string): Observable<Caso> {
    return this.http.post<Caso>(`${this.base}/${id}/tomar`, {});
  }

  obtener(id: string): Observable<Caso> {
    return this.http.get<Caso>(`${this.base}/${id}`);
  }

  auditoria(id: string): Observable<EventoCaso[]> {
    return this.http.get<EventoCaso[]>(`${this.base}/${id}/auditoria`);
  }

  agregarNota(id: string, texto: string): Observable<EventoCaso> {
    return this.http.post<EventoCaso>(`${this.base}/${id}/notas`, { texto });
  }
}
