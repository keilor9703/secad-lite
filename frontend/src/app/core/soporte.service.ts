import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Lo que responde el backend al abrir un reporte. */
export interface RespuestaTicket {
  /** El número del reporte: «FC-261015-7K3Q». */
  id: string;
  /** ¿Llegó a la mesa? Si es falso, el reporte NO salió: hay que copiarlo. */
  enviado: boolean;
  /** Qué pasó con la copia para quien reportó. */
  acuse: 'enviado' | 'sin-correo' | 'fallo';
  /** A qué buzón se mandó. */
  mesa: string;
  error?: string;
}

/**
 * Manda el reporte de soporte al backend, que lo reparte por correo (ver
 * `backend/src/soporte/`). Lo que viaja es exactamente lo que el diálogo
 * mostró en pantalla: el relato y el contexto técnico, sin agregar nada.
 */
@Injectable({ providedIn: 'root' })
export class SoporteService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  abrirTicket(cuerpo: {
    severidad: string; relato: string; contexto: string; pantalla: string;
  }): Promise<RespuestaTicket> {
    return firstValueFrom(this.http.post<RespuestaTicket>(`${this.base}/soporte/ticket`, cuerpo));
  }
}
