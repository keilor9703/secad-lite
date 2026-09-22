import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Caso, MensajeChatInterno } from './models';

/**
 * Canal WebSocket para recibir actualizaciones de casos en tiempo real.
 * El backend emite 'caso:nuevo' y 'caso:actualizado' al tenant.
 * Se conecta al namespace /casos del backend.
 */
@Injectable({ providedIn: 'root' })
export class CasosWsService implements OnDestroy {
  private socket: Socket | null = null;
  private readonly caso$ = new Subject<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }>();
  private readonly chat$ = new Subject<MensajeChatInterno>();

  constructor(private auth: AuthService) {}

  /** Conecta al namespace /casos autenticado con el token JWT. */
  conectar(): void {
    if (this.socket?.connected) return;
    const token = this.auth.sesion()?.token;
    if (!token) return;

    const wsUrl = environment.apiBaseUrl.replace('/api', '');
    this.socket = io(`${wsUrl}/casos`, {
      // El superadmin no tiene tenant propio: se manda el que tiene en
      // gestión (mismo patrón que PbxService.conectar()) — sin esto el
      // backend no sabe a qué sala de tenant unirlo y nunca le llega nada
      // en vivo (ni el tablero de Despacho, ni el chat interno).
      auth: { token, tenant: this.auth.tenantActivo() },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    this.socket.on('caso:nuevo', (caso: Caso) => this.caso$.next({ tipo: 'nuevo', caso }));
    this.socket.on('caso:actualizado', (caso: Caso) => this.caso$.next({ tipo: 'actualizado', caso }));
    this.socket.on('chat:mensaje', (m: MensajeChatInterno) => this.chat$.next(m));
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  /**
   * Se une a la sala de chat de UN caso — solo mientras su detalle está en
   * pantalla, para no recibir el chat de casos que nadie tiene abiertos aquí.
   */
  unirseAChat(casoId: string): void {
    this.socket?.emit('caso:unirse', casoId);
  }

  salirDeChat(casoId: string): void {
    this.socket?.emit('caso:salir', casoId);
  }

  /** Observable de eventos de casos (nuevo o actualizado). */
  get eventos(): Observable<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }> {
    return this.caso$.asObservable();
  }

  /** Observable de mensajes de chat interno (de cualquier caso al que se haya unido). */
  get mensajesChat(): Observable<MensajeChatInterno> {
    return this.chat$.asObservable();
  }

  ngOnDestroy(): void {
    this.desconectar();
  }
}
