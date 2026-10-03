import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { VideollamadaService } from '../../core/videollamada.service';
import { VideollamadaComponent } from '../../pages/despacho/videollamada/videollamada';

/** Dónde está el panel. */
type Modo = 'flotante' | 'acoplada';

/** Margen mínimo para que la ventana no se pueda arrastrar fuera de la vista. */
const MARGEN = 24;

/**
 * Caparazón del panel de videollamada: una ventana que flota sobre el sistema
 * y se puede acoplar dentro del caso.
 *
 * Vive en `app.html`, POR ENCIMA del enrutador. Esa es toda la razón de que
 * exista: mientras el panel estuvo dentro de la página del caso, cambiar de
 * pantalla destruía el componente y tumbaba la llamada. Aquí sobrevive a
 * cualquier navegación, y el despachador puede consultar otro caso, mirar el
 * mapa o recepcionar mientras sigue viendo al ciudadano.
 *
 * Arranca ACOPLADO, en el hueco de la página, que es donde el operador espera
 * encontrar la videollamada: al lado del caso que está atendiendo, con el mapa
 * a la vista. Flotar es una decisión del operador, no el estado por omisión.
 *
 * Solo flota sin que nadie lo pida cuando no hay dónde acoplarse —el operador
 * se fue a otra pantalla—, y vuelve al hueco en cuanto regresa. Esa ida y
 * vuelta no cuenta como haber desacoplado: si el operador SÍ desacopló a mano,
 * se respeta y no se le vuelve a meter en el hueco a sus espaldas.
 */
@Component({
  selector: 'app-videollamada-flotante',
  standalone: true,
  imports: [VideollamadaComponent],
  templateUrl: './videollamada-flotante.html',
  styleUrl: './videollamada-flotante.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideollamadaFlotanteComponent implements AfterViewInit, OnDestroy {
  readonly video = inject(VideollamadaService);

  private readonly caja = viewChild<ElementRef<HTMLElement>>('caja');
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly modo = signal<Modo>('acoplada');
  readonly visible = computed(() => !!this.video.casoPanel());

  /**
   * El operador oprimió «Desacoplar». Distingue flotar porque lo pidió de
   * flotar porque la página que ofrecía el hueco ya no está — sin esta
   * distinción, volver al caso no podría devolver el panel a su sitio sin
   * pisar una decisión suya.
   */
  private readonly desacoploElOperador = signal(false);

  /** Panel de la llamada anterior, para reiniciar el modo en cada llamada nueva. */
  private panelPrevio: string | null = null;

  /** Posición de la ventana flotante, en píxeles desde la esquina superior izquierda. */
  readonly x = signal(0);
  readonly y = signal(0);
  private arrastrando = false;
  private dx = 0;
  private dy = 0;

  /** Solo se puede acoplar si la página actual ofrece un sitio donde hacerlo. */
  readonly puedeAcoplar = computed(() => !!this.video.anclaje());

  constructor() {
    // Mover el elemento entre el anclaje de la página y el cuerpo del
    // documento. Mover nodos del DOM no rompe nada de Angular: el componente
    // sigue siendo el mismo, con sus suscripciones y su <video> intactos —que
    // es justo por lo que la llamada no se corta al acoplar o desacoplar.
    effect(() => {
      const caja = this.caja()?.nativeElement;
      if (!caja) return;
      const ancla = this.video.anclaje();
      const destino = this.modo() === 'acoplada' && ancla ? ancla : this.host.nativeElement;
      if (caja.parentElement !== destino) destino.appendChild(caja);
    });

    // Cada llamada nueva empieza acoplada: el «desacoplé a mano» de la llamada
    // anterior no debe heredarse a la siguiente.
    effect(() => {
      const panel = this.video.casoPanel();
      if (panel && panel !== this.panelPrevio) this.desacoploElOperador.set(false);
      this.panelPrevio = panel;
    });

    // Dónde debe estar el panel cuando nadie lo ha movido a mano:
    //   sin anclaje  → flotando, porque no hay hueco donde ponerlo.
    //   con anclaje  → en el hueco, que es el estado por omisión.
    effect(() => {
      if (!this.video.anclaje()) {
        if (this.modo() === 'acoplada') this.modo.set('flotante');
      } else if (!this.desacoploElOperador() && this.modo() === 'flotante') {
        this.modo.set('acoplada');
      }
    });
  }

  ngAfterViewInit(): void {
    this.colocarAlInicio();

    // La página llama a esto justo antes de destruirse, para que el panel
    // salga del hueco sin pasar por un instante fuera del árbol.
    this.video.devolverAFlotante.set(() => {
      const caja = this.caja()?.nativeElement;
      if (caja && caja.parentElement !== this.host.nativeElement) {
        this.host.nativeElement.appendChild(caja);
      }
      // No se marca `desacoploElOperador`: esto es la página yéndose, no una
      // decisión suya. Al volver al caso, el panel se reacopla solo.
      this.modo.set('flotante');
      this.colocarAlInicio();
    });
  }

  ngOnDestroy(): void {
    this.soltar();
    this.video.devolverAFlotante.set(null);
  }

  /** Abajo a la derecha, que es donde no tapa el trabajo. */
  private colocarAlInicio(): void {
    const caja = this.caja()?.nativeElement;
    const ancho = caja?.offsetWidth || 420;
    const alto = caja?.offsetHeight || 460;
    this.x.set(Math.max(MARGEN, window.innerWidth - ancho - MARGEN));
    this.y.set(Math.max(MARGEN, window.innerHeight - alto - MARGEN));
  }

  alternarAcople(): void {
    this.modo.update((m) => (m === 'acoplada' ? 'flotante' : 'acoplada'));
    // Se guarda la DECISIÓN, no solo el estado: es lo que impide que el efecto
    // de arriba vuelva a acoplar el panel que el operador acaba de soltar.
    this.desacoploElOperador.set(this.modo() === 'flotante');
    if (this.modo() === 'flotante') queueMicrotask(() => this.colocarAlInicio());
  }

  async pantallaCompleta(): Promise<void> {
    const caja = this.caja()?.nativeElement;
    if (!caja) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await caja.requestFullscreen?.();
  }

  cerrar(): void {
    this.video.cerrarPanel();
  }

  // ── Arrastre ────────────────────────────────────────────────────────────
  // Con eventos de puntero y no de ratón: así funciona igual con dedo y con
  // lápiz, que en una sala de despacho con pantallas táctiles no es raro.

  empezarArrastre(ev: PointerEvent): void {
    if (this.modo() !== 'flotante') return;
    const caja = this.caja()?.nativeElement;
    if (!caja) return;
    this.arrastrando = true;
    this.dx = ev.clientX - this.x();
    this.dy = ev.clientY - this.y();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  moverArrastre(ev: PointerEvent): void {
    if (!this.arrastrando) return;
    const caja = this.caja()?.nativeElement;
    const ancho = caja?.offsetWidth ?? 0;
    const alto = caja?.offsetHeight ?? 0;
    // Acotado a la ventana: una ventana arrastrada fuera de la vista es una
    // ventana perdida, y aquí dentro hay una llamada de emergencia.
    this.x.set(Math.min(Math.max(MARGEN - ancho + 80, ev.clientX - this.dx), window.innerWidth - 80));
    this.y.set(Math.min(Math.max(0, ev.clientY - this.dy), window.innerHeight - 48));
  }

  soltar(): void {
    this.arrastrando = false;
  }
}
