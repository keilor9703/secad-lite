import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Llamada, PbxConfig } from './models';

/**
 * Cliente de la integración con la planta telefónica (PBX). Mantiene la cola de
 * llamadas en vivo (REST inicial + Socket.IO namespace /pbx) para el screen-pop,
 * y expone la configuración (API key + webhook) para administración.
 */
@Injectable({ providedIn: 'root' })
export class PbxService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private socket?: Socket;

  /** Cola de llamadas (recientes primero). */
  readonly llamadas = signal<Llamada[]>([]);
  /** Solo las que están timbrando. */
  readonly sonando = computed(() => this.llamadas().filter((l) => l.estado === 'sonando'));
  /** Última llamada entrante no atendida, para avisos globales. */
  readonly ultimaEntrante = signal<Llamada | null>(null);

  private readonly base = environment.apiBaseUrl;
  private get wsBase(): string {
    return environment.apiBaseUrl.replace(/\/api\/?$/, '');
  }

  /** Carga la cola y abre el canal en vivo (idempotente). */
  conectar(): void {
    this.recargar();
    if (this.socket?.connected) return;
    this.socket = io(`${this.wsBase}/pbx`, {
      auth: { token: this.auth.token },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('llamada:entrante', (l: Llamada) => { this.upsert(l); this.ultimaEntrante.set(l); });
    this.socket.on('llamada:cambio', (l: Llamada) => this.upsert(l));
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = undefined;
  }

  recargar(): void {
    this.http.get<Llamada[]>(`${this.base}/pbx/llamadas`).subscribe({
      next: (ls) => this.llamadas.set(ls),
      error: () => {},
    });
  }

  atender(id: string): Observable<{ llamada: Llamada; casoId: string }> {
    return this.http.post<{ llamada: Llamada; casoId: string }>(`${this.base}/pbx/llamadas/${id}/atender`, {});
  }

  config(): Observable<PbxConfig> {
    return this.http.get<PbxConfig>(`${this.base}/pbx/config`);
  }

  rotarKey(): Observable<PbxConfig> {
    return this.http.post<PbxConfig>(`${this.base}/pbx/config/rotar`, {});
  }

  /** URL completa del webhook para pegar en la configuración de la PBX. */
  webhookUrl(path: string): string {
    const origin = this.base.replace(/\/api\/?$/, '');
    return `${origin}${path}`;
  }

  private upsert(l: Llamada): void {
    this.llamadas.update((arr) => {
      const i = arr.findIndex((x) => x.id === l.id);
      if (i === -1) return [l, ...arr];
      const copia = arr.slice();
      copia[i] = l;
      return copia;
    });
    if (l.estado !== 'sonando' && this.ultimaEntrante()?.id === l.id) this.ultimaEntrante.set(null);
  }
}
