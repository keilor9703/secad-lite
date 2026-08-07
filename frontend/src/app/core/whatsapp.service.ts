import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MensajeChat, WhatsappConfig } from './models';

/** Cliente de la integración de WhatsApp (Cloud API de Meta). */
@Injectable({ providedIn: 'root' })
export class WhatsappService {
  private http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** Conversación de un caso de canal WhatsApp. */
  mensajes(casoId: string): Observable<MensajeChat[]> {
    return this.http.get<MensajeChat[]>(`${this.base}/whatsapp/casos/${casoId}/mensajes`);
  }

  /** El operador responde al ciudadano por WhatsApp. */
  responder(casoId: string, texto: string): Observable<MensajeChat> {
    return this.http.post<MensajeChat>(`${this.base}/whatsapp/casos/${casoId}/responder`, { texto });
  }

  config(): Observable<WhatsappConfig> {
    return this.http.get<WhatsappConfig>(`${this.base}/whatsapp/config`);
  }

  guardarConfig(
    phoneNumberId: string,
    accessToken?: string,
    agenciaResponsableId?: string | null,
    canales?: string[],
  ): Observable<WhatsappConfig> {
    return this.http.put<WhatsappConfig>(
      `${this.base}/whatsapp/config`, { phoneNumberId, accessToken, agenciaResponsableId, canales },
    );
  }

  webhookUrl(path: string): string {
    return `${this.base.replace(/\/api\/?$/, '')}${path}`;
  }
}
