import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { ChatService } from '../../core/chat.service';
import { DespachoService } from '../../core/despacho.service';
import { Asignacion, Canal, Caso, EstadoAsignacion, EstadoCaso, EventoCaso, MensajeChat, RecursoSugerido, TipoEvento } from '../../core/models';

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
  private despachoSvc = inject(DespachoService);

  /** Supervisor/admin: habilita cerrar y reabrir. */
  readonly privilegiado = this.auth.privilegiado;

  // Despacho
  readonly asignaciones = signal<Asignacion[]>([]);
  readonly sugeridos = signal<RecursoSugerido[]>([]);
  recursoSel = '';

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
        this.cargarDespacho();
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
    if (estado === 'cerrado' && this.asignaciones().some((a) => this.activa(a))
        && !window.confirm('El caso tiene recursos en atención. Al cerrar se liberarán automáticamente. ¿Continuar?')) {
      return;
    }
    this.casosSvc.cambiarEstado(this.id, estado, agencia).subscribe({
      next: (c) => { this.caso.set(c); this.cargarAuditoria(); this.cargarDespacho(); },
      error: () => this.error.set('No fue posible actualizar el estado.'),
    });
  }

  // Despacho -----------------------------------------------------------------
  private cargarDespacho(): void {
    this.despachoSvc.asignaciones(this.id).subscribe({ next: (a) => this.asignaciones.set(a) });
    this.despachoSvc.recursosSugeridos(this.id).subscribe({ next: (s) => this.sugeridos.set(s) });
  }

  despachar(): void {
    if (!this.recursoSel) return;
    this.despachoSvc.despachar(this.id, this.recursoSel).subscribe({
      next: () => { this.recursoSel = ''; this.refrescarTrasDespacho(); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible despachar el recurso.'),
    });
  }

  avanzar(a: Asignacion, estado: EstadoAsignacion): void {
    let motivo: string | undefined;
    if (estado === 'cancelada') {
      const m = window.prompt('Motivo de la cancelación:');
      if (!m?.trim()) return;
      motivo = m.trim();
    }
    this.despachoSvc.cambiarEstado(a.id, estado, motivo).subscribe({
      next: () => this.refrescarTrasDespacho(),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el despacho.'),
    });
  }

  private refrescarTrasDespacho(): void {
    this.cargarDespacho();
    this.cargarAuditoria();
    this.casosSvc.obtener(this.id).subscribe({ next: (c) => this.caso.set(c) });
  }

  /** Siguientes fases posibles del despacho de un recurso (excluye cancelar). */
  siguientes(a: Asignacion): EstadoAsignacion[] {
    return ({ asignado: ['en_ruta', 'en_sitio'], en_ruta: ['en_sitio'], en_sitio: ['finalizada'], finalizada: [], cancelada: [] } as Record<EstadoAsignacion, EstadoAsignacion[]>)[a.estado];
  }
  activa(a: Asignacion): boolean {
    return a.estado === 'asignado' || a.estado === 'en_ruta' || a.estado === 'en_sitio';
  }
  estadoAsigLabel(e: EstadoAsignacion): string {
    return { asignado: 'Asignado', en_ruta: 'En ruta', en_sitio: 'En sitio', finalizada: 'Finalizada', cancelada: 'Cancelada' }[e];
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
    return ({ nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' } as Record<string, string>)[e] ?? e;
  }
  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', integracion: '🔌' }[c];
  }
  eventoIcon(t: TipoEvento): string {
    return { creacion: '🟢', estado: '🔁', derivacion: '➡️', nota: '📝', despacho: '🚓' }[t];
  }
}
