import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { SoftphoneService } from '../../core/softphone/softphone.service';
import { IconoComponent } from '../../shared/icono/icono';
import { acotar, guardarPosicion, posicionGuardada, posicionPorDefecto } from './posicion';

/**
 * EL TELÉFONO, DENTRO DE FALCON
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PLEGADA ES UN ICONO; LA LLAMADA LA DESPLIEGA
 *
 * Un panel permanente en una esquina es un estorbo permanente: en Recepción
 * tapaba el mapa, y en una sala de despacho lo que se mira todo el día es la
 * pantalla, no el teléfono.
 *
 * Así que en reposo es solo un botón redondo con el auricular y un punto de
 * color que dice si está listo. Cuando entra una llamada se despliega sola
 * —se estira a una barra delgada con el número y los botones— y cuando la
 * llamada termina se vuelve a plegar. El operador no tiene que ir a buscarla
 * ni que apartarla: aparece cuando hace falta y desaparece cuando no.
 *
 * Y se puede arrastrar a donde quiera, porque ninguna esquina es buena para
 * todos: la posición se recuerda en ese puesto de trabajo. Arranca arriba a
 * la derecha, bajo la cabecera, que es la única zona que en Recepción no tapa
 * ni la cola, ni el formulario, ni el mapa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VIVE POR ENCIMA DEL ENRUTADOR
 *
 * Una llamada no se puede caer por cambiar de pantalla: el operador contesta
 * mirando la cola y acaba escribiendo el caso en Recepción, y es la misma
 * conversación.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Component({
  selector: 'app-softphone',
  standalone: true,
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sp.disponible()) {
      <div class="sp" #barra
           [class.sp--abierta]="abierta()"
           [class.sp--sonando]="!!sp.entrante() && !sp.contestando()"
           [class.sp--contestando]="sp.contestando()"
           [class.sp--encurso]="!!sp.enCurso()"
           [class.sp--arrastrando]="arrastrando()"
           [style.left.px]="pos().x" [style.top.px]="pos().y"
           (pointerdown)="tomar($event)">

        <!-- Donde suena la llamada. No lleva controles: los del navegador
             invitan a silenciar el altavoz creyendo que se silencia el
             micrófono. Y NO se oculta con display:none — un elemento que no
             se renderiza puede no reproducir en algunos navegadores. -->
        <audio #audio autoplay class="sp-audio"></audio>

        <!-- El asa: plegada es el botón; desplegada, lo que se agarra. -->
        <button type="button" class="sp-icono" [attr.aria-label]="rotulo()"
                [attr.aria-expanded]="abierta()" (click)="alternar()">
          <app-icono [nombre]="sp.enCurso() ? 'altavoz' : 'telefono'" [tam]="18" />
          <span class="sp-punto" [attr.data-estado]="sp.estado()"></span>
        </button>

        @if (abierta()) {
          <div class="sp-cuerpo">
            @if (sp.entrante(); as l) {
              <span class="sp-txt">
                <!-- El clic tiene que verse AL INSTANTE. Contestar tarda lo
                     que el navegador tarde en recolectar sus candidatos ICE,
                     y sin este cambio la barra se quedaba idéntica: el
                     operador volvía a oprimir creyendo que no había entrado
                     su clic, y el segundo clic podía dejar la llamada
                     contestada y sin tomar en la cola. -->
                <strong>{{ titulo() }}</strong>
                <small>
                  {{ detalle(l.numero) }}{{ sp.contestando() ? ' · conectando el audio' : '' }}
                </small>
              </span>
              <span class="sp-acc">
                <button type="button" class="btn mini" [disabled]="sp.contestando()"
                        (click)="sp.contestar()">
                  {{ sp.contestando() ? 'Conectando…' : (sp.esMiSaliente() ? 'Descolgar' : 'Contestar') }}
                </button>
                <!-- Rechazar SIGUE habilitado: si el audio no conecta, colgar
                     es la única salida que le queda al operador. En una
                     saliente propia no se «rechaza» nada: se desiste. -->
                <button type="button" class="btn btn--ghost mini" (click)="sp.colgar()">
                  {{ sp.esMiSaliente() ? 'Desistir' : 'Rechazar' }}
                </button>
              </span>
            } @else if (sp.enCurso(); as l) {
              <span class="sp-txt">
                <strong>{{ sp.sinAudioRemoto() ? 'En llamada · sin audio' : 'En llamada' }}</strong>
                <small>{{ l.numero || 'número oculto' }}</small>
              </span>
              <span class="sp-acc">
                <button type="button" class="btn btn--ghost mini" [attr.aria-pressed]="sp.silenciado()"
                        (click)="sp.alternarSilencio()">
                  <app-icono [nombre]="sp.silenciado() ? 'micro-off' : 'micro'" [tam]="14" />
                  {{ sp.silenciado() ? 'Reactivar' : 'Silenciar' }}
                </button>
                @if (sp.companeros().length) {
                  <button type="button" class="btn btn--ghost mini"
                          [attr.aria-expanded]="eligiendoDestino()"
                          [disabled]="sp.transfiriendo()"
                          (click)="alternarTransferir()">
                    <app-icono nombre="flecha-der" [tam]="14" />
                    {{ sp.transfiriendo() ? 'Pasando…' : 'Pasar a' }}
                  </button>
                }
                <button type="button" class="btn btn--danger mini" (click)="sp.colgar()">Colgar</button>
              </span>

              @if (eligiendoDestino()) {
                <div class="sp-destinos">
                  <!--
                    Se dice ANTES de elegir, no después: una vez oprimido, la
                    llamada ya salió. Y se dice lo que de verdad pasa —vuelve a
                    la sala— en vez de un «¿está seguro?» que nadie lee.
                  -->
                  <p class="sp-aviso">
                    La llamada pasa de inmediato. Si no contesta, vuelve a la cola.
                  </p>
                  @for (c of sp.companeros(); track c.extension) {
                    <button type="button" class="sp-destino"
                            [disabled]="sp.transfiriendo()"
                            (click)="pasarA(c.extension)">
                      <strong>{{ c.nombre }}</strong>
                      <span class="mono">ext. {{ c.extension }}</span>
                    </button>
                  }
                </div>
              }
            } @else {
              <span class="sp-txt">
                <strong>Teléfono</strong>
                <small>{{ etiquetaEstado() }}{{ sp.extension() ? ' · ext. ' + sp.extension() : '' }}</small>
              </span>
              <span class="sp-acc">
                @if (sp.estado() === 'apagado') {
                  <button type="button" class="btn mini" (click)="sp.encender()">Encender</button>
                } @else {
                  <button type="button" class="btn btn--ghost mini" (click)="sp.apagar()">Apagar</button>
                }
              </span>
            }
          </div>
        }

        <!-- Lo que pasó con la llamada en la cola, o por qué no se puede
             encender. Solo cuando hay algo que decir, y nunca tapando los
             botones: debajo de la barra. -->
        @if (abierta() && (sp.sinAudioRemoto() || sp.avisoCola() || sp.motivo())) {
          <p class="sp-aviso" role="status">
            @if (sp.sinAudioRemoto()) {
              <strong>No está llegando el audio de la otra parte.</strong>
              La llamada está en pie y a usted lo oyen, pero no va a oír nada:
              avise a soporte —es un problema de red, no de la llamada—.
            }
            {{ sp.avisoCola() || sp.motivo() }}
            @if (sp.avisoCola()) {
              <button type="button" class="sp-enlace" (click)="irARecepcion()">Ir a Recepción</button>
            }
          </p>
        }
      </div>
    }
  `,
  styleUrl: './softphone.scss',
})
export class SoftphoneComponent implements AfterViewInit, OnDestroy {
  readonly sp = inject(SoftphoneService);
  private readonly router = inject(Router);
  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');
  private readonly barra = viewChild<ElementRef<HTMLElement>>('barra');

  /** Desplegada o plegada. */
  readonly abierta = signal(false);
  readonly arrastrando = signal(false);
  readonly pos = signal({ x: 0, y: 0 });

  /** Puesta a mano: mientras dure, no se pliega sola. */
  private fijadaAMano = false;
  private plegarMasTarde?: ReturnType<typeof setTimeout>;

  /** Dónde se agarró la barra respecto de su esquina, para que no dé un salto. */
  private agarre = { x: 0, y: 0 };
  /** El último elemento entregado, para no repetir la entrega en cada cambio. */
  private audioEntregado?: HTMLAudioElement;

  /**
   * Qué dice la barra mientras timbra.
   *
   * «Entra una llamada» para lo que el propio operador acaba de pedir es
   * falso, y lleva a oprimir «Rechazar» cancelando su propia marcación.
   */
  readonly titulo = computed(() => {
    if (this.sp.contestando()) return 'Contestando…';
    return this.sp.esMiSaliente() ? 'Su llamada saliente' : 'Entra una llamada';
  });

  /** La línea de abajo: a quién se llama, o quién llama. */
  readonly detalle = (numero: string): string => {
    if (!this.sp.esMiSaliente()) return numero || 'número oculto';
    const a = this.sp.destinoSaliente();
    return a
      ? `Descuelgue y la central marca a ${a}`
      : 'Descuelgue y la central marca al número del caso';
  };

  readonly rotulo = computed(() => {
    if (this.sp.contestando()) return 'Contestando, conectando el audio. Abrir el teléfono';
    if (this.sp.esMiSaliente() && this.sp.entrante())
      return 'Su llamada saliente espera que descuelgue. Abrir el teléfono';
    if (this.sp.entrante()) return 'Entra una llamada. Abrir el teléfono';
    if (this.sp.enCurso()) return 'En llamada. Abrir el teléfono';
    return `Teléfono: ${this.etiquetaEstado()}. ${this.abierta() ? 'Plegar' : 'Desplegar'}`;
  });

  constructor() {
    // ────────────────────────────────────────────────────────────────────────
    // EL ELEMENTO DE AUDIO SE ENTREGA CUANDO APARECE, NO AL ARRANCAR
    //
    // Esto fue una llamada de una sola vía en producción: al operador lo oían
    // y él no oía nada. La causa no estaba en SIP ni en los servidores ICE,
    // estaba aquí.
    //
    // El `<audio>` vive dentro de `@if (sp.disponible())`, y eso es FALSO en
    // el primer render: depende de las capacidades de la planta, que llegan
    // del servidor. `ngAfterViewInit` corre una sola vez, justo entonces, no
    // encontraba el elemento y nunca se lo entregaba a la pila SIP — así que
    // el flujo remoto no tenía dónde sonar. El micrófono sí funcionaba porque
    // se captura por otro camino, y de ahí que fuera de una sola vía.
    //
    // Un `effect` sobre el `viewChild` lo entrega en cuanto existe, pase lo
    // que pase con el orden de arranque. Lo mismo con la posición, que
    // necesita medir la barra.
    // ────────────────────────────────────────────────────────────────────────
    effect(() => {
      const el = this.audio()?.nativeElement;
      if (!el || el === this.audioEntregado) return;
      this.audioEntregado = el;
      this.sp.usarAudio(el);
      this.pos.set(acotar(posicionGuardada() ?? posicionPorDefecto(this.medidas()), this.medidas()));
    });

    // Una llamada despliega la barra sola, y al terminar se vuelve a plegar.
    // Es lo que evita tener que ir a buscarla con el ciudadano esperando.
    effect(() => {
      const hayLlamada = !!this.sp.entrante() || !!this.sp.enCurso();
      if (hayLlamada) {
        clearTimeout(this.plegarMasTarde);
        this.abierta.set(true);
        return;
      }
      if (this.fijadaAMano || !this.abierta()) return;
      // Un respiro antes de plegar: al colgar queda en pantalla el aviso de
      // qué pasó con la llamada en la cola, y plegarse al instante se lo
      // llevaría antes de que nadie lo lea.
      clearTimeout(this.plegarMasTarde);
      this.plegarMasTarde = setTimeout(() => this.abierta.set(false), 6000);
    });
  }

  ngAfterViewInit(): void {
    window.addEventListener('resize', this.alRedimensionar);
  }

  ngOnDestroy(): void {
    clearTimeout(this.plegarMasTarde);
    window.removeEventListener('resize', this.alRedimensionar);
    window.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.alSoltar);
  }

  alternar(): void {
    const abriendo = !this.abierta();
    this.abierta.set(abriendo);
    // Abrirla a mano la deja abierta; cerrarla a mano devuelve el automatismo.
    this.fijadaAMano = abriendo;
    clearTimeout(this.plegarMasTarde);
  }

  /** ¿Está abierta la lista de a quién pasarle la llamada? */
  readonly eligiendoDestino = signal(false);

  alternarTransferir(): void {
    this.eligiendoDestino.set(!this.eligiendoDestino());
  }

  /**
   * Pasa la llamada y cierra la lista.
   *
   * La lista se cierra pase lo que pase: si salió bien, la llamada ya no es
   * de este puesto; si salió mal, el motivo se ve en la barra y dejar la
   * lista abierta invita a oprimir otra vez sobre una llamada que quizá ya
   * no existe.
   */
  async pasarA(extension: string): Promise<void> {
    await this.sp.transferir(extension);
    this.eligiendoDestino.set(false);
  }

  irARecepcion(): void {
    void this.router.navigate(['/recepcion']);
  }

  etiquetaEstado(): string {
    return {
      apagado: 'apagado',
      conectando: 'conectando…',
      registrado: 'listo',
      fallo: 'sin conexión',
    }[this.sp.estado()];
  }

  /**
   * Empieza el arrastre, salvo que se haya agarrado un botón.
   *
   * Sin esa salvedad, «Contestar» se convierte en un arrastre de dos píxeles
   * y la llamada no se contesta — con el ciudadano al teléfono.
   */
  tomar(e: PointerEvent): void {
    if ((e.target as HTMLElement)?.closest('button')) return;
    const caja = this.barra()?.nativeElement.getBoundingClientRect();
    if (!caja) return;
    this.agarre = { x: e.clientX - caja.left, y: e.clientY - caja.top };
    this.arrastrando.set(true);
    window.addEventListener('pointermove', this.alMover);
    window.addEventListener('pointerup', this.alSoltar);
  }

  private readonly alMover = (e: PointerEvent): void => {
    if (!this.arrastrando()) return;
    e.preventDefault();
    this.pos.set(acotar({ x: e.clientX - this.agarre.x, y: e.clientY - this.agarre.y }, this.medidas()));
  };

  private readonly alSoltar = (): void => {
    if (!this.arrastrando()) return;
    this.arrastrando.set(false);
    window.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.alSoltar);
    guardarPosicion(this.pos());
  };

  /** Una ventana más pequeña no puede dejar la barra fuera de la pantalla. */
  private readonly alRedimensionar = (): void => this.pos.set(acotar(this.pos(), this.medidas()));

  private medidas() {
    const caja = this.barra()?.nativeElement.getBoundingClientRect();
    return {
      ventanaAncho: window.innerWidth,
      ventanaAlto: window.innerHeight,
      barraAncho: caja?.width || 46,
      barraAlto: caja?.height || 46,
    };
  }
}
