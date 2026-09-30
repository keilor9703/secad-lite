import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChatMensaje, EstadoLlamada, UbicacionCiudadano, VideollamadaActiva, VideollamadaService,
} from '../../../core/videollamada.service';
import { ToastService } from '../../../shared/toast/toast.service';

/**
 * Videollamada con el ciudadano, dentro del panel del caso en Despacho.
 *
 * El despachador no sale del caso para atender por video: sigue viendo la
 * información del incidente y despachando recursos mientras habla.
 */
@Component({
  selector: 'app-videollamada',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './videollamada.html',
  styleUrl: './videollamada.scss',
})
export class VideollamadaComponent implements OnDestroy {
  readonly casoId = input.required<string>();
  /** Teléfono del ciudadano tomado del caso; el despachador puede corregirlo. */
  readonly telefono = input<string | null>(null);

  private readonly video = inject(VideollamadaService);
  private readonly toast = inject(ToastService);

  private readonly videoRemoto = viewChild<ElementRef<HTMLVideoElement>>('remoto');

  readonly estado = signal<EstadoLlamada>('inactiva');
  readonly error = signal('');
  readonly chat = signal<ChatMensaje[]>([]);
  readonly chatDisponible = signal(false);
  readonly ubicacion = signal<UbicacionCiudadano | null>(null);
  readonly microfono = signal(true);
  readonly grabando = signal(false);
  private readonly remoto = signal<MediaStream | null>(null);

  readonly numero = signal('');
  readonly enlace = signal('');
  readonly chatTexto = signal('');
  readonly abriendo = signal(false);

  /** Cuánto lleva la llamada. En una emergencia el tiempo es información. */
  readonly duracion = signal('');
  private reloj: ReturnType<typeof setInterval> | null = null;
  private inicio = 0;

  readonly chatAbierto = signal(false);
  /** Mensajes llegados mientras el chat estaba plegado. */
  readonly sinLeer = signal(0);

  /** Llamada ya abierta para este caso, a la que se puede volver. */
  readonly reconectable = signal<VideollamadaActiva | null>(null);
  readonly reconectando = signal(false);

  /** Hay sala: se muestra la consola de la llamada, no el lanzador. */
  readonly enCurso = computed(() => this.estado() !== 'inactiva' && this.estado() !== 'finalizada');

  /** A qué caso pertenece la llamada que está en curso ahora mismo. */
  private casoEnLlamada = '';

  constructor() {
    this.video.estado$.pipe(takeUntilDestroyed()).subscribe((e) => {
      this.estado.set(e);
      this.vigilarDuracion();
    });
    this.video.error$.pipe(takeUntilDestroyed()).subscribe((e) => this.error.set(e));
    this.video.chat$.pipe(takeUntilDestroyed()).subscribe((c) => {
      // Un mensaje nuevo con el chat plegado se anuncia en el botón: el
      // despachador está mirando el video, no la lista.
      if (c.length > this.chat().length && !this.chatAbierto()) {
        this.sinLeer.update((n) => n + (c.length - this.chat().length));
      }
      this.chat.set(c);
    });
    this.video.chatDisponible$.pipe(takeUntilDestroyed()).subscribe((d) => this.chatDisponible.set(d));
    this.video.ubicacion$.pipe(takeUntilDestroyed()).subscribe((u) => this.ubicacion.set(u));
    this.video.microfono$.pipe(takeUntilDestroyed()).subscribe((m) => this.microfono.set(m));
    this.video.grabando$.pipe(takeUntilDestroyed()).subscribe((g) => this.grabando.set(g));
    this.video.remoto$.pipe(takeUntilDestroyed()).subscribe((s) => this.remoto.set(s));

    // El <video> solo existe mientras la llamada está conectada, así que puede
    // no estar montado cuando llega el stream. Un efecto espera a que coexistan
    // los dos en vez de perderlo: `viewChild` también es señal y vuelve a
    // disparar esto en cuanto el elemento aparece.
    effect(() => {
      const el = this.videoRemoto()?.nativeElement;
      const stream = this.remoto();
      if (el) el.srcObject = stream;
    });

    // Cambiar de caso es salir del caso: igual que en SECAD, la llamada del
    // caso anterior se cierra guardando la grabación. Dejarla viva mostraría en
    // este panel el video de OTRO incidente.
    effect(() => {
      const id = this.casoId();
      // Solo el caso dispara esto: leer el estado de la llamada aquí sin aislar
      // volvería a consultar el servidor en cada cambio de estado.
      untracked(() => {
        if (this.enCurso() && this.casoEnLlamada && this.casoEnLlamada !== id) {
          this.video.abandonar();
        }
        this.enlace.set('');
        void this.buscarActiva(id);
      });
    });

    // El teléfono llega con el caso y puede tardar: se propone como número a
    // llamar, y el despachador lo corrige si el ciudadano dio otro.
    effect(() => this.numero.set(this.telefono() ?? ''));
  }

  ngOnDestroy(): void {
    // Salir del caso no puede perder la grabación: se cierra en segundo plano.
    if (this.enCurso()) this.video.abandonar();
    this.pararReloj();
  }

  /** Arranca o para el cronómetro según el estado de la llamada. */
  private vigilarDuracion(): void {
    if (this.estado() === 'conectada') {
      if (this.reloj) return;
      this.inicio = Date.now();
      this.duracion.set('0:00');
      this.reloj = setInterval(() => {
        const s = Math.floor((Date.now() - this.inicio) / 1000);
        this.duracion.set(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      }, 1000);
    } else if (!this.enCurso()) {
      this.pararReloj();
      this.duracion.set('');
    }
  }

  private pararReloj(): void {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
  }

  alternarChat(): void {
    this.chatAbierto.update((v) => !v);
    if (this.chatAbierto()) this.sinLeer.set(0);
  }

  /**
   * ¿Este caso ya tiene una llamada abierta? Pasa tras un F5, un cambio de
   * pestaña, una caída de red o un relevo de turno. Se ofrece VOLVER a ella en
   * vez de mandarle al ciudadano un segundo enlace y dejarlo hablando solo.
   */
  private async buscarActiva(casoId: string): Promise<void> {
    this.reconectable.set(null);
    try {
      const r = await this.video.activa(casoId);
      if (r?.hay && r.sesionId && casoId === this.casoId()) this.reconectable.set(r);
    } catch {
      // Que no se pueda consultar no debe romper el panel del caso: el
      // despachador simplemente no verá la opción de retomar.
    }
  }

  async reconectar(): Promise<void> {
    const activa = this.reconectable();
    if (!activa?.sesionId) return;

    this.reconectando.set(true);
    try {
      this.enlace.set(activa.enlace ?? '');
      this.casoEnLlamada = this.casoId();
      await this.video.iniciar(activa.sesionId);
      this.reconectable.set(null);
    } catch {
      this.toast.error('No se pudo retomar la videollamada.');
    } finally {
      this.reconectando.set(false);
    }
  }

  async llamar(): Promise<void> {
    const numero = this.numero().trim();
    if (!numero) {
      this.toast.error('Indique el número de celular del ciudadano.');
      return;
    }

    this.abriendo.set(true);
    try {
      const r = await this.video.crear(this.casoId(), numero);
      this.enlace.set(r.enlace);
      this.reconectable.set(null);
      this.casoEnLlamada = this.casoId();
      await this.video.iniciar(r.sesionId);

      // El enlace se muestra SIEMPRE, haya salido el SMS o no: si no salió, el
      // despachador puede dictarlo por teléfono y la atención no se detiene.
      if (r.smsEnviado) this.toast.exito(r.mensaje);
      else this.toast.error(r.mensaje);
    } catch {
      this.toast.error('No se pudo abrir la videollamada.');
    } finally {
      this.abriendo.set(false);
    }
  }

  copiarEnlace(): void {
    const enlace = this.enlace();
    if (!enlace) return;
    void navigator.clipboard?.writeText(enlace)
      .then(() => this.toast.exito('Enlace copiado.'))
      .catch(() => this.toast.error('No se pudo copiar; selecciónelo a mano.'));
  }

  enviarChat(): void {
    const texto = this.chatTexto().trim();
    if (!texto) return;
    this.video.enviarChat(texto);
    this.chatTexto.set('');
  }

  alternarMicrofono(): void { this.video.alternarMicrofono(); }

  async grabar(): Promise<void> {
    if (this.grabando()) {
      const ok = await this.video.finalizarGrabacion();
      this.toast.exito(ok
        ? 'Grabación guardada en el caso.'
        : 'La grabación se cerrará sola en el servidor; lo grabado está a salvo.');
      return;
    }
    await this.video.iniciarGrabacion();
  }

  async colgar(): Promise<void> {
    await this.video.colgar();
    this.enlace.set('');
    this.casoEnLlamada = '';
    this.chatAbierto.set(false);
    this.sinLeer.set(0);
  }

  /** Para el enlace al mapa con la posición que reportó el ciudadano. */
  urlMapa(u: UbicacionCiudadano): string {
    return `https://www.google.com/maps?q=${u.lat},${u.lng}`;
  }

  pantallaCompleta(): void {
    const el = this.videoRemoto()?.nativeElement;
    if (el && el.requestFullscreen) {
      el.requestFullscreen();
    }
  }

  async desacoplar(): Promise<void> {
    const el = this.videoRemoto()?.nativeElement;
    if (el && document.pictureInPictureEnabled) {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await el.requestPictureInPicture();
      }
    } else {
      this.toast.error('Su navegador no soporta desacoplar videos (Picture-in-Picture).');
    }
  }
}
