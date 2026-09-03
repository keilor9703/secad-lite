import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Caso } from './models';

/**
 * Canal WebSocket para recibir actualizaciones de casos en tiempo real.
 * El backend emite 'caso:nuevo' y 'caso:actualizado' al tenant.
 * Se conecta al namespace /casos del backend.
 */
@Injectable({ providedIn: 'root' })
export class CasosWsService implements OnDestroy {
  private socket: Socket | null = null;
  private readonly caso$ = new Subject<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }>();

  constructor(private auth: AuthService) {}

  /** Conecta al namespace /casos autenticado con el token JWT. */
  conectar(): void {
    if (this.socket?.connected) return;
    const token = this.auth.sesion()?.token;
    if (!token) return;

    const wsUrl = environment.apiBaseUrl.replace('/api', '');
    this.socket = io(`${wsUrl}/casos`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    this.socket.on('caso:nuevo', (caso: Caso) => this.caso$.next({ tipo: 'nuevo', caso }));
    this.socket.on('caso:actualizado', (caso: Caso) => this.caso$.next({ tipo: 'actualizado', caso }));
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  /** Observable de eventos de casos (nuevo o actualizado). */
  get eventos(): Observable<{ tipo: 'nuevo' | 'actualizado'; caso: Caso }> {
    return this.caso$.asObservable();
  }

  ngOnDestroy(): void {
    this.desconectar();
  }
}
