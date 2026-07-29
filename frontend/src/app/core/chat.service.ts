import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { Caso, MensajeChat } from './models';

/**
 * Cliente del chat en tiempo real (Socket.IO, namespace /chat). Autentica con el
 * JWT de la sesión. Expone streams para caso nuevo, historial y mensajes.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private auth = inject(AuthService);
  private socket?: Socket;

  /** Caso nuevo iniciado por un ciudadano (lo reciben los funcionarios). */
  readonly nuevo$ = new Subject<Caso>();
  /** Historial al unirse a la sala de un caso. */
  readonly historial$ = new Subject<{ casoId: string; mensajes: MensajeChat[] }>();
  /** Mensaje individual en tiempo real. */
  readonly mensaje$ = new Subject<MensajeChat>();
  /** Confirmación de que el chat del ciudadano quedó creado. */
  readonly iniciado$ = new Subject<{ casoId: string; mensaje: MensajeChat }>();

  private get wsBase(): string {
    return environment.apiBaseUrl.replace(/\/api\/?$/, '');
  }

  conectar(): void {
    if (this.socket?.connected) return;
    this.socket = io(`${this.wsBase}/chat`, {
      auth: { token: this.auth.token },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('chat:nuevo', ({ caso }: { caso: Caso }) => this.nuevo$.next(caso));
    this.socket.on('chat:historial', (p: { casoId: string; mensajes: MensajeChat[] }) => this.historial$.next(p));
    this.socket.on('chat:mensaje', (m: MensajeChat) => this.mensaje$.next(m));
    this.socket.on('chat:iniciado', (p: { casoId: string; mensaje: MensajeChat }) => this.iniciado$.next(p));
  }

  iniciar(texto: string): void {
    this.socket?.emit('chat:iniciar', { texto });
  }

  unir(casoId: string): void {
    this.socket?.emit('chat:unir', { casoId });
  }

  enviar(casoId: string, texto: string): void {
    this.socket?.emit('chat:mensaje', { casoId, texto });
  }

  desconectar(): void {
    this.socket?.disconnect();
    this.socket = undefined;
  }
}
