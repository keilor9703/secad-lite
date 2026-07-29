import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatService } from '../../core/chat.service';
import { AuthService } from '../../core/auth.service';
import { MensajeChat } from '../../core/models';

/** Chat del ciudadano: inicia una conversación que crea un caso y conversa en vivo. */
@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class ChatComponent implements OnInit, OnDestroy {
  private chat = inject(ChatService);
  private auth = inject(AuthService);

  readonly mensajes = signal<MensajeChat[]>([]);
  readonly casoId = signal<string | null>(null);
  texto = '';
  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.chat.conectar();
    this.subs.push(
      this.chat.iniciado$.subscribe(({ casoId, mensaje }) => {
        this.casoId.set(casoId);
        this.mensajes.update((m) => [...m, mensaje]);
      }),
      this.chat.mensaje$.subscribe((m) => this.mensajes.update((arr) => [...arr, m])),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.chat.desconectar();
  }

  enviar(): void {
    const t = this.texto.trim();
    if (!t) return;
    if (!this.casoId()) this.chat.iniciar(t);
    else this.chat.enviar(this.casoId()!, t);
    this.texto = '';
  }

  get nombre(): string {
    return this.auth.sesion()?.nombre ?? 'Ciudadano';
  }
}
