import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { ChatService } from '../../core/chat.service';
import { DespachoService } from '../../core/despacho.service';
import { WhatsappService } from '../../core/whatsapp.service';
import { ToastService } from '../../shared/toast/toast.service';
import {
  Agencia, Asignacion, Canal, CanalAtencion, Caso, CodigoCierre, EstadoAsignacion, EstadoCaso,
  EventoCaso, MensajeChat, Recurso, TenantDirectorio, TipoEvento,
} from '../../core/models';

@Component({
  selector: 'app-detalle',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetalleComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private casosSvc = inject(CasosService);
  private auth = inject(AuthService);
  private chat = inject(ChatService);
  private despachoSvc = inject(DespachoService);
  private catalogos = inject(CatalogosService);
  private whatsappSvc = inject(WhatsappService);
  private toast = inject(ToastService);

  /** Supervisor/admin: habilita cerrar y reabrir. */
  readonly privilegiado = this.auth.privilegiado;

  // Despacho
  readonly asignaciones = signal<Asignacion[]>([]);
  readonly disponibles = signal<Recurso[]>([]);
  readonly recursoSelCtrl = new FormControl('', { nonNullable: true });

  readonly caso = signal<Caso | null>(null);
  /** Catálogos para traducir los ids de agencia y canal a nombres. */
  private readonly agencias = signal<Agencia[]>([]);
  private readonly canalesAtencion = signal<CanalAtencion[]>([]);
  readonly eventos = signal<EventoCaso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');

  // Chat en vivo (solo casos de canal 'chat').
  readonly chatMensajes = signal<MensajeChat[]>([]);
  readonly chatForm = new FormGroup({ texto: new FormControl('', { nonNullable: true }) });
  private chatSubs: Subscription[] = [];

  // Conversación WhatsApp (solo casos de canal 'whatsapp').
  readonly waMensajes = signal<MensajeChat[]>([]);
  readonly waForm = new FormGroup({ texto: new FormControl('', { nonNullable: true }) });
  readonly waEnviando = signal(false);
  readonly waError = signal('');
  private waPoll?: ReturnType<typeof setInterval>;

  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'derivado', 'cerrado'];

  readonly notaForm = new FormGroup({ texto: new FormControl('', { nonNullable: true }) });
  readonly guardandoNota = signal(false);
  /**
   * Caso a mostrar. Cuando el detalle se incrusta dentro del módulo de despacho
   * llega por aquí; como página propia, se toma de la ruta.
   */
  readonly casoId = input<string>();
  /** Oculta el enlace de volver cuando ya se está dentro de otro módulo. */
  readonly incrustado = input(false);
  /** Avisa al módulo que lo contiene: el tablero se recarga y el caso se mueve. */
  readonly cambiado = output<void>();

  /**
   * Cierre clasificado: sin código ni comentario no se puede cerrar. Los
   * desenlaces son catálogo del secad, así que solo se ofrecen los vigentes.
   */
  readonly codigosCierre = signal<CodigoCierre[]>([]);
  readonly mostrarCierre = signal(false);
  readonly cierreForm = new FormGroup({
    codigo: new FormControl('', { nonNullable: true }),
    comentario: new FormControl('', { nonNullable: true }),
  });
  readonly cerrando = signal(false);

  private id = '';

  /**
   * Reacciona al caso a mostrar: corre una vez al montar (ruta propia o
   * `casoId` inicial cuando está embebido) y de nuevo cada vez que el tablero
   * que lo contiene cambia de `casoId`. Reemplaza el `ngOnChanges` clásico.
   */
  private readonly cargarAlCambiarCaso = effect(() => {
    const nuevo = this.casoId() ?? this.route.snapshot.paramMap.get('id') ?? '';
    if (nuevo && nuevo !== this.id) {
      this.id = nuevo;
      this.caso.set(null);
      this.cargar();
      this.cargarAuditoria();
      this.cargarDespacho();
    }
  });

  ngOnInit(): void {
    this.catalogos.cierres(true).subscribe({ next: (c) => this.codigosCierre.set(c), error: () => {} });
    this.catalogos.agencias().subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    this.catalogos.canales().subscribe({ next: (c) => this.canalesAtencion.set(c), error: () => {} });
  }

  // --- Reapertura de un caso cerrado ------------------------------------------

  /** Solo un supervisor (casos.reabrir) reabre; el resto lo solicita. */
  readonly puedeReabrir = computed(() => this.auth.tienePermiso('casos.reabrir'));
  readonly puedeCerrar = computed(() => this.auth.tienePermiso('casos.cerrar'));
  readonly mostrarReapertura = signal(false);
  readonly motivoReaperturaCtrl = new FormControl('', { nonNullable: true });
  readonly enviandoReapertura = signal(false);

  abrirReapertura(): void {
    this.motivoReaperturaCtrl.reset('');
    this.mostrarReapertura.set(true);
  }

  /**
   * Con autorización reabre el caso; sin ella deja la solicitud para que un
   * supervisor la resuelva. En ambos casos el motivo es obligatorio y queda en
   * la trazabilidad.
   */
  enviarReapertura(): void {
    const motivo = this.motivoReaperturaCtrl.value.trim();
    if (!motivo) { this.error.set('Escriba el motivo.'); return; }
    this.enviandoReapertura.set(true);
    const peticion = this.puedeReabrir()
      ? this.casosSvc.reabrir(this.id, motivo)
      : this.casosSvc.solicitarReapertura(this.id, motivo);
    peticion.subscribe({
      next: (c) => {
        this.caso.set(c);
        this.enviandoReapertura.set(false);
        this.mostrarReapertura.set(false);
        this.cargarAuditoria();
        this.cambiado.emit();
        this.toast.exito(this.puedeReabrir() ? 'Caso reabierto.' : 'Solicitud de reapertura enviada.');
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

  readonly mostrarRemitir = signal(false);
  readonly remisionForm = new FormGroup({
    agenciaId: new FormControl('', { nonNullable: true }),
    observacion: new FormControl('', { nonNullable: true }),
    exclusivo: new FormControl(false, { nonNullable: true }),
  });
  readonly remisionCanales = signal<string[]>([]);
  readonly remitiendo = signal(false);

  /** Agencias a las que se puede remitir. */
  agenciasActivas(): Agencia[] {
    return this.agencias().filter((a) => a.activo);
  }

  /** Canales de la agencia elegida como destino. */
  canalesDestino(): CanalAtencion[] {
    const id = this.remisionForm.controls.agenciaId.value;
    return id ? this.canalesAtencion().filter((c) => c.agenciaId === id && c.activo) : [];
  }

  abrirRemitir(): void {
    this.remisionForm.reset({ agenciaId: '', observacion: '', exclusivo: false });
    this.remisionCanales.set([]);
    this.mostrarRemitir.set(true);
  }

  cambiarAgenciaDestino(id: string): void {
    this.remisionForm.controls.agenciaId.setValue(id);
    this.remisionCanales.set([]); // los canales eran de la agencia anterior
  }

  canalRemisionMarcado(id: string): boolean {
    return this.remisionCanales().includes(id);
  }

  alternarCanalRemision(id: string): void {
    this.remisionCanales.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
  }

  remitir(): void {
    const v = this.remisionForm.getRawValue();
    if (!v.agenciaId || !this.remisionCanales().length) {
      this.error.set('Elija la agencia destino y al menos un canal.');
      return;
    }
    if (v.exclusivo &&
        !window.confirm('El caso saldrá de la cola de la agencia actual y quedará solo en la nueva. ¿Continuar?')) {
      return;
    }
    this.remitiendo.set(true);
    this.casosSvc.remitir(this.id, {
      agenciaResponsableId: v.agenciaId,
      canales: this.remisionCanales(),
      observacion: v.observacion.trim() || undefined,
      exclusivo: v.exclusivo,
    }).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.remitiendo.set(false);
        this.mostrarRemitir.set(false);
        this.cargarAuditoria();
        this.cambiado.emit();
        this.toast.exito('Caso remitido a la agencia destino.');
      },
      error: (e) => {
        this.remitiendo.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible remitir el caso.');
      },
    });
  }

  // --- Remisión a otra jurisdicción (otro tenant) -----------------------------

  readonly puedeRemitirTenant = computed(() => this.auth.tienePermiso('casos.remitir_tenant'));
  readonly mostrarRemitirTenant = signal(false);
  readonly tenantsDestino = signal<TenantDirectorio[]>([]);
  readonly remisionTenantForm = new FormGroup({
    tenantDestino: new FormControl('', { nonNullable: true }),
    observacion: new FormControl('', { nonNullable: true }),
  });
  readonly remitiendoTenant = signal(false);

  abrirRemitirTenant(): void {
    this.remisionTenantForm.reset({ tenantDestino: '', observacion: '' });
    this.mostrarRemitirTenant.set(true);
    if (!this.tenantsDestino().length) {
      this.casosSvc.tenantsRemitibles().subscribe({
        next: (ts) => this.tenantsDestino.set(ts),
        error: () => this.error.set('No fue posible cargar las instancias disponibles.'),
      });
    }
  }

  remitirTenant(): void {
    const v = this.remisionTenantForm.getRawValue();
    if (!v.tenantDestino) {
      this.error.set('Elija la instancia destino.');
      return;
    }
    if (!v.observacion.trim()) {
      this.error.set('Indique el motivo de la remisión.');
      return;
    }
    const destino = this.tenantsDestino().find((t) => t.codigo === v.tenantDestino);
    if (!window.confirm(
      `El caso quedará derivado en esta instancia y se creará uno nuevo en ${destino?.nombre ?? v.tenantDestino}. ¿Continuar?`,
    )) {
      return;
    }
    this.remitiendoTenant.set(true);
    this.casosSvc.remitirTenant(this.id, {
      tenantDestino: v.tenantDestino,
      observacion: v.observacion.trim(),
    }).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.remitiendoTenant.set(false);
        this.mostrarRemitirTenant.set(false);
        this.cargarAuditoria();
        this.cambiado.emit();
        this.toast.exito('Caso remitido a otra jurisdicción.');
      },
      error: (e) => {
        this.remitiendoTenant.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible remitir el caso a esa instancia.');
      },
    });
  }

  /**
   * Abrir un caso nuevo es hacerse cargo de él: el sistema lo pasa a gestión y
   * lo deja escrito, en vez de esperar a que alguien se acuerde de cambiarlo.
   */
  private tomarSiEsNuevo(c: Caso): void {
    if (c.estado !== 'nuevo' || !this.auth.tienePermiso('casos.gestionar')) return;
    this.casosSvc.tomar(c.id).subscribe({
      next: (act) => { this.caso.set(act); this.cargarAuditoria(); this.cambiado.emit(); },
      error: () => {},
    });
  }

  abrirCierre(): void {
    this.cierreForm.reset({ codigo: '', comentario: '' });
    this.mostrarCierre.set(true);
  }

  /** Cierra el caso con su clasificación; el resto de estados van solos. */
  confirmarCierre(): void {
    const v = this.cierreForm.getRawValue();
    if (!v.codigo) { this.error.set('Elija el código de cierre.'); return; }
    if (!v.comentario.trim()) { this.error.set('Escriba el comentario de cierre.'); return; }
    if (this.asignaciones().some((a) => this.activa(a))
        && !window.confirm('El caso tiene recursos en atención. Al cerrar se liberarán automáticamente. ¿Continuar?')) {
      return;
    }
    this.cerrando.set(true);
    this.casosSvc.cerrar(this.id, v.codigo, v.comentario.trim()).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.cerrando.set(false);
        this.mostrarCierre.set(false);
        this.cargarAuditoria();
        this.cargarDespacho();
        this.cambiado.emit();
        this.toast.exito('Caso cerrado.');
      },
      error: (e) => {
        this.cerrando.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible cerrar el caso.');
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
    const t = this.waForm.controls.texto.value.trim();
    if (!t) return;
    this.waEnviando.set(true);
    this.waError.set('');
    this.whatsappSvc.responder(this.id, t).subscribe({
      next: (m) => { this.waMensajes.update((arr) => [...arr, m]); this.waForm.reset({ texto: '' }); this.waEnviando.set(false); },
      error: (e) => { this.waEnviando.set(false); this.waError.set(e?.error?.message ?? 'No fue posible enviar la respuesta.'); },
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
    const t = this.chatForm.controls.texto.value.trim();
    if (!t) return;
    this.chat.enviar(this.id, t);
    this.chatForm.reset({ texto: '' });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.casosSvc.obtener(this.id).subscribe({
      next: (c) => {
        this.caso.set(c);
        this.cargarAuditoria();
        this.cargarDespacho();
        this.tomarSiEsNuevo(c);
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
      next: (c) => {
        this.caso.set(c);
        this.cargarAuditoria();
        this.cargarDespacho();
        this.cambiado.emit();
        this.toast.exito(`Estado actualizado a ${this.estadoLabel(estado).toLowerCase()}.`);
      },
      error: () => this.error.set('No fue posible actualizar el estado.'),
    });
  }

  // Despacho -----------------------------------------------------------------
  private cargarDespacho(): void {
    this.despachoSvc.asignaciones(this.id).subscribe({ next: (a) => this.asignaciones.set(a) });
    this.despachoSvc.disponibles().subscribe({ next: (r) => this.disponibles.set(r) });
  }

  despachar(): void {
    const recursoSel = this.recursoSelCtrl.value;
    if (!recursoSel) return;
    this.despachoSvc.despachar(this.id, recursoSel).subscribe({
      next: () => { this.recursoSelCtrl.reset(''); this.refrescarTrasDespacho(); this.toast.exito('Recurso despachado.'); },
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
      next: () => { this.refrescarTrasDespacho(); this.toast.exito(`Recurso pasó a ${this.estadoAsigLabel(estado).toLowerCase()}.`); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el despacho.'),
    });
  }

  private refrescarTrasDespacho(): void {
    this.cargarDespacho();
    this.cargarAuditoria();
    this.casosSvc.obtener(this.id).subscribe({ next: (c) => this.caso.set(c) });
      // El caso pudo pasar a 'con recursos': el tablero debe reflejarlo.
    this.cambiado.emit();
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
    const t = this.notaForm.controls.texto.value.trim();
    if (!t) return;
    this.guardandoNota.set(true);
    this.casosSvc.agregarNota(this.id, t).subscribe({
      next: (ev) => { this.eventos.update((e) => [...e, ev]); this.notaForm.reset({ texto: '' }); this.guardandoNota.set(false); this.toast.exito('Nota agregada.'); },
      error: () => { this.error.set('No fue posible guardar la nota.'); this.guardandoNota.set(false); },
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
