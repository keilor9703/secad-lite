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
  /**
   * Solo las que están timbrando Y le corresponden a esta sesión: una llamada
   * que otro operador ya tomó (o que el ACD dirigió a otro) desaparece de la
   * cola en cuanto llega su aviso — es la misma regla que aplica el servidor
   * al listar, repetida aquí porque los avisos en vivo van a todo el tenant.
   * Un supervisor (casos.ver_todos) las ve todas, con la pista de para quién.
   */
  readonly sonando = computed(() => {
    const s = this.auth.sesion();
    const yo = s?.usuario;
    const supervisor = s?.rol === 'superadmin' || (s?.permisos ?? []).includes('casos.ver_todos');
    return this.llamadas().filter(
      (l) => l.estado === 'sonando' && (supervisor || !l.destinatario || l.destinatario === yo),
    );
  });
  /** Última llamada entrante no atendida, para avisos globales. */
  readonly ultimaEntrante = signal<Llamada | null>(null);

  private readonly base = environment.apiBaseUrl;
  /**
   * Origen del canal en vivo. En desarrollo se deduce de la API; publicado, se
   * toma de `wsBaseUrl`, porque el proxy del alojamiento estático no reenvía
   * websockets y habría que ir directo al backend.
   */
  private get wsBase(): string {
    const explicito = (environment as { wsBaseUrl?: string }).wsBaseUrl;
    if (explicito) return explicito;
    return environment.apiBaseUrl.replace(/\/api\/?$/, '');
  }

  /** Sin origen de websocket no hay canal en vivo que abrir. */
  private get hayCanalVivo(): boolean {
    return !!(environment as { wsBaseUrl?: string }).wsBaseUrl || !environment.apiBaseUrl.startsWith('/');
  }

  /** Carga la cola y abre el canal en vivo (idempotente). */
  conectar(): void {
    this.recargar();
    // Sin canal en vivo la cola sigue funcionando por consulta; solo no hay aviso.
    if (!this.hayCanalVivo || this.socket?.connected) return;
    this.socket = io(`${this.wsBase}/pbx`, {
      // El superadmin no tiene tenant propio: indica cuál escucha.
      auth: { token: this.auth.token, tenant: this.auth.tenantActivo() },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('llamada:entrante', (l: Llamada) => { this.upsert(l); this.ultimaEntrante.set(l); });
    this.socket.on('llamada:cambio', (l: Llamada) => this.upsert(l));
  }

  /** Reabre la cola tras cambiar de tenant en gestión (superadmin). */
  reconectar(): void {
    this.desconectar();
    this.llamadas.set([]);
    this.ultimaEntrante.set(null);
    this.conectar();
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

  /** Toma la llamada para completarla en el formulario de Recepción. */
  reclamar(id: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/reclamar`, {});
  }

  /** Suelta una llamada tomada sin guardar caso: vuelve a la cola compartida. */
  soltar(id: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/soltar`, {});
  }

  /** Enlaza la llamada con el caso que el formulario acaba de guardar. */
  vincular(id: string, casoId: string): Observable<Llamada> {
    return this.http.post<Llamada>(`${this.base}/pbx/llamadas/${id}/vincular`, { casoId });
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
