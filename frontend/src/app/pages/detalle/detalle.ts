import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { ChatService } from '../../core/chat.service';
import { DespachoService } from '../../core/despacho.service';
import { WhatsappService } from '../../core/whatsapp.service';
import {
  Agencia, Asignacion, Canal, CanalAtencion, Caso, EstadoAsignacion, EstadoCaso, EventoCaso,
  MensajeChat, RecursoSugerido, TipoEvento,
} from '../../core/models';

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
  private catalogos = inject(CatalogosService);
  private whatsappSvc = inject(WhatsappService);

  /** Supervisor/admin: habilita cerrar y reabrir. */
  readonly privilegiado = this.auth.privilegiado;

  // Despacho
  readonly asignaciones = signal<Asignacion[]>([]);
  readonly sugeridos = signal<RecursoSugerido[]>([]);
  recursoSel = '';

  readonly caso = signal<Caso | null>(null);
  /** Catálogos para traducir los ids de agencia y canal a nombres. */
  private readonly agencias = signal<Agencia[]>([]);
  private readonly canalesAtencion = signal<CanalAtencion[]>([]);
  readonly eventos = signal<EventoCaso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  // Chat en vivo (solo casos de canal 'chat').
  readonly chatMensajes = signal<MensajeChat[]>([]);
  chatTexto = '';
  private chatSubs: Subscription[] = [];

  // Conversación WhatsApp (solo casos de canal 'whatsapp').
  readonly waMensajes = signal<MensajeChat[]>([]);
  waTexto = '';
  waEnviando = false;
  readonly waError = signal('');
  private waPoll?: ReturnType<typeof setInterval>;

  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'derivado', 'cerrado'];

  nota = '';
  guardandoNota = false;
  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.cargar();
    this.catalogos.agencias().subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    this.catalogos.canales().subscribe({ next: (c) => this.canalesAtencion.set(c), error: () => {} });
  }

  // --- Reapertura de un caso cerrado ------------------------------------------

  /** Solo un supervisor (casos.reabrir) reabre; el resto lo solicita. */
  readonly puedeReabrir = computed(() => this.auth.tienePermiso('casos.reabrir'));
  readonly puedeCerrar = computed(() => this.auth.tienePermiso('casos.cerrar'));
  mostrarReapertura = false;
  motivoReapertura = '';
  readonly enviandoReapertura = signal(false);

  abrirReapertura(): void {
    this.motivoReapertura = '';
    this.mostrarReapertura = true;
  }

  /**
   * Con autorización reabre el caso; sin ella deja la solicitud para que un
   * supervisor la resuelva. En ambos casos el motivo es obligatorio y queda en
   * la trazabilidad.
   */
  enviarReapertura(): void {
    const motivo = this.motivoReapertura.trim();
    if (!motivo) { this.error.set('Escriba el motivo.'); return; }
    this.enviandoReapertura.set(true);
    const peticion = this.puedeReabrir()
      ? this.casosSvc.reabrir(this.id, motivo)
      : this.casosSvc.solicitarReapertura(this.id, motivo);
    peticion.subscribe({
      next: (c) => {
        this.caso.set(c);
        this.enviandoReapertura.set(false);
        this.mostrarReapertura = false;
        this.cargarAuditoria();
      },
      error: (e) => {
        this.enviandoReapertura.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible procesar la reapertura.');
      },
    });
  }

  /** Estados que este funcionario puede fijar desde los botones. */
  bloqueadoPorPermiso(estado: EstadoCaso): boolean {
    const c = this.caso();
    if (!c) return true;
    if (estado === 'cerrado') return !this.puedeCerrar();
    // Salir de 'cerrado' solo por la vía de la reapertura autorizada.
    return c.estado === 'cerrado';
  }

    // --- Remisión a otra entidad ------------------------------------------------

  mostrarRemitir = false;
  remision = { agenciaId: '', canales: [] as string[], observacion: '', exclusivo: false };
  readonly remitiendo = signal(false);

  /** Agencias a las que se puede remitir. */
  agenciasActivas(): Agencia[] {
    return this.agencias().filter((a) => a.activo);
  }

  /** Canales de la agencia elegida como destino. */
  canalesDestino(): CanalAtencion[] {
    const id = this.remision.agenciaId;
    return id ? this.canalesAtencion().filter((c) => c.agenciaId === id && c.activo) : [];
  }

  abrirRemitir(): void {
    this.remision = { agenciaId: '', canales: [], observacion: '', exclusivo: false };
    this.mostrarRemitir = true;
  }

  cambiarAgenciaDestino(id: string): void {
    this.remision.agenciaId = id;
    this.remision.canales = []; // los canales eran de la agencia anterior
  }

  canalRemisionMarcado(id: string): boolean {
    return this.remision.canales.includes(id);
  }

  alternarCanalRemision(id: string): void {
    this.remision.canales = this.canalRemisionMarcado(id)
      ? this.remision.canales.filter((c) => c !== id)
      : [...this.remision.canales, id];
  }

  remitir(): void {
    if (!this.remision.agenciaId || !this.remision.canales.length) {
      this.error.set('Elija la agencia destino y al menos un canal.');
      return;
    }
    if (this.remision.exclusivo &&
        !window.confirm('El caso saldrá de la cola de la agencia actual y quedará solo en la nueva. ¿Continuar?')) {
      return;
    }
    this.remitiendo.set(true);
    this.casosSvc.remitir(this.id, {
      agenciaResponsableId: this.remision.agenciaId,
      canales: this.remision.canales,
      observacion: this.remision.observacion.trim() || undefined,
      exclusivo: this.remision.exclusivo,
    }).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.remitiendo.set(false);
        this.mostrarRemitir = false;
        this.cargarAuditoria();
      },
      error: (e) => {
        this.remitiendo.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible remitir el caso.');
      },
    });
  }

  /** Nombre de la agencia; los casos antiguos no la tienen. */
  nombreAgencia(id: string | null | undefined): string {
    if (!id) return '—';
    return this.agencias().find((a) => a.id === id)?.nombre ?? '—';
  }

  /** Nombre del canal de atención al que se envió el caso. */
  nombreCanal(id: string): string {
    const c = this.canalesAtencion().find((x) => x.id === id);
    return c ? `${c.codigo} · ${c.nombre}` : id.slice(0, 8);
  }

  /** Une dirección, barrio y ciudad omitiendo lo que no se diligenció. */
  ubicacionTexto(c: Caso): string {
    return [c.direccion, c.barrio, c.ciudad].filter((p) => p?.trim()).join(', ') || 'Sin dirección';
  }

  ngOnDestroy(): void {
    this.chatSubs.forEach((s) => s.unsubscribe());
    this.chat.desconectar();
    if (this.waPoll) clearInterval(this.waPoll);
  }

  // WhatsApp -----------------------------------------------------------------
  private iniciarWhatsapp(): void {
    this.cargarWhatsapp();
    this.waPoll = setInterval(() => { if (!document.hidden) this.cargarWhatsapp(); }, 4000);
  }

  private cargarWhatsapp(): void {
    this.whatsappSvc.mensajes(this.id).subscribe({ next: (m) => this.waMensajes.set(m), error: () => {} });
  }

  responderWhatsapp(): void {
    const t = this.waTexto.trim();
    if (!t) return;
    this.waEnviando = true;
    this.waError.set('');
    this.whatsappSvc.responder(this.id, t).subscribe({
      next: (m) => { this.waMensajes.update((arr) => [...arr, m]); this.waTexto = ''; this.waEnviando = false; },
      error: (e) => { this.waEnviando = false; this.waError.set(e?.error?.message ?? 'No fue posible enviar la respuesta.'); },
    });
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
        if (c.canal === 'whatsapp' && !this.waPoll) this.iniciarWhatsapp();
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
    // Derivar deja de ser un texto libre: se hace con el panel de remisión, que
    // elige agencia y canales reales del catálogo.
    if (estado === 'derivado') { this.abrirRemitir(); return; }
    const agencia: string | undefined = undefined;
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
    return { llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c];
  }
  eventoIcon(t: TipoEvento): string {
    return { creacion: '🟢', estado: '🔁', derivacion: '➡️', nota: '📝', despacho: '🚓' }[t];
  }
}
