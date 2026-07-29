import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { ChatService } from '../../core/chat.service';
import { Canal, Caso, EstadoCaso, EventoCaso, MensajeChat, TipoEvento } from '../../core/models';

@Component({
  selector: 'app-detalle',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class DetalleComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private casosSvc = inject(CasosService);
  private auth = inject(AuthService);
  private chat = inject(ChatService);

  /** Supervisor/admin: habilita cerrar y reabrir. */
  readonly privilegiado = this.auth.privilegiado;

  readonly caso = signal<Caso | null>(null);
  readonly eventos = signal<EventoCaso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  // Chat en vivo (solo casos de canal 'chat').
  readonly chatMensajes = signal<MensajeChat[]>([]);
  chatTexto = '';
  private chatSubs: Subscription[] = [];

  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'derivado', 'cerrado'];

  nota = '';
  guardandoNota = false;
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.cargar();
  }

  ngOnDestroy(): void {
    this.chatSubs.forEach((s) => s.unsubscribe());
    this.chat.desconectar();
  }

  /** Conecta el chat en vivo para atender un caso de canal 'chat'. */
  private iniciarChat(): void {
    this.chat.conectar();
    this.chatSubs.push(
      this.chat.historial$.subscribe(({ casoId, mensajes }) => {
        if (casoId === this.id) this.chatMensajes.set(mensajes);
      }),
      this.chat.mensaje$.subscribe((m) => {
        if (m.casoId === this.id) this.chatMensajes.update((arr) => [...arr, m]);
      }),
    );
    this.chat.unir(this.id);
  }

  enviarChat(): void {
    const t = this.chatTexto.trim();
    if (!t) return;
    this.chat.enviar(this.id, t);
    this.chatTexto = '';
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.casosSvc.obtener(this.id).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.cargarAuditoria();
        if (c.canal === 'chat' && this.chatSubs.length === 0) this.iniciarChat();
      },
      error: () => { this.error.set('No fue posible cargar el caso.'); this.cargando.set(false); },
    });
  }

  private cargarAuditoria(): void {
    this.casosSvc.auditoria(this.id).subscribe({
      next: (evs) => { this.eventos.set(evs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la bitácora.'); this.cargando.set(false); },
    });
  }

  cambiarEstado(estado: EstadoCaso): void {
    let agencia: string | undefined;
    if (estado === 'derivado') {
      const dest = window.prompt('Agencia destino para derivar:', this.caso()?.agencia);
      if (!dest?.trim()) return;
      agencia = dest.trim();
    }
    this.casosSvc.cambiarEstado(this.id, estado, agencia).subscribe({
      next: (c) => { this.caso.set(c); this.cargarAuditoria(); },
      error: () => this.error.set('No fue posible actualizar el estado.'),
    });
  }

  agregarNota(): void {
    const t = this.nota.trim();
    if (!t) return;
    this.guardandoNota = true;
    this.casosSvc.agregarNota(this.id, t).subscribe({
      next: (ev) => { this.eventos.update((e) => [...e, ev]); this.nota = ''; this.guardandoNota = false; },
      error: () => { this.error.set('No fue posible guardar la nota.'); this.guardandoNota = false; },
    });
  }

  /** ¿El botón de este estado está vedado para el rol actual? */
  bloqueado(e: EstadoCaso): boolean {
    if (this.privilegiado()) return false;
    if (e === 'cerrado') return true;                 // cerrar
    if (this.caso()?.estado === 'cerrado') return true; // reabrir (e ya no es 'cerrado' aquí)
    return false;
  }

  // Etiquetas -----------------------------------------------------------------
  estadoLabel(e: EstadoCaso | string): string {
    return ({ nuevo: 'Nuevo', en_gestion: 'En gestión', derivado: 'Derivado', cerrado: 'Cerrado' } as Record<string, string>)[e] ?? e;
  }
  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', integracion: '🔌' }[c];
  }
  eventoIcon(t: TipoEvento): string {
    return { creacion: '🟢', estado: '🔁', derivacion: '➡️', nota: '📝' }[t];
  }
}
