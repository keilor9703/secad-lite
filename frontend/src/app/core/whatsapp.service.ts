import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CanalEnlace, MensajeChat, WhatsappConfig } from './models';

/** Algo que impide que la línea funcione, y dónde se arregla. */
export interface FaltaWhatsapp {
  que: string;
  comoSeArregla: string;
  /** Lo arregla quien opera el servidor, no el administrador del municipio. */
  esDelServidor?: boolean;
}

/** En qué está la línea de WhatsApp de esta instancia. */
export interface EstadoWhatsapp {
  via: 'infobip' | 'meta' | null;
  listo: boolean;
  faltan: FaltaWhatsapp[];
  /** Lo que pasó POR FALCON. No es la factura del proveedor. */
  consumo: { entrantes: number; salientes: number; dias: number };
  ultimoEntrante: string | null;
}

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
    numero: string,
    accessToken?: string,
    agenciaResponsableId?: string | null,
    canales?: string[],
    /**
     * Orden de salida del enlace de la videollamada. `null` = que decida el
     * sistema; omitirlo deja el que haya guardado.
     */
    ordenEnlace?: CanalEnlace[] | null,
  ): Observable<WhatsappConfig> {
    return this.http.put<WhatsappConfig>(
      `${this.base}/whatsapp/config`,
      { phoneNumberId, numero, accessToken, agenciaResponsableId, canales, ordenEnlace },
    );
  }

  /** Qué le falta a esta línea, y cuánto se mueve. */
  estado(): Observable<EstadoWhatsapp> {
    return this.http.get<EstadoWhatsapp>(`${this.base}/whatsapp/estado`);
  }

  /** Manda un mensaje de prueba a un número y cuenta qué contestó el proveedor. */
  probar(a: string): Observable<{ ok: boolean; detalle: string }> {
    return this.http.post<{ ok: boolean; detalle: string }>(`${this.base}/whatsapp/probar`, { a });
  }

  webhookUrl(path: string): string {
    return `${this.base.replace(/\/api\/?$/, '')}${path}`;
  }
}
