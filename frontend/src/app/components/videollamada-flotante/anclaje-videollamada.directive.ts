import { Directive, ElementRef, OnDestroy, effect, inject, input } from '@angular/core';
import { VideollamadaService } from '../../core/videollamada.service';

/**
 * Marca el hueco de la página donde el panel de videollamada se incrusta
 * cuando está ACOPLADO, y de paso declara qué caso está mirando el operador.
 *
 * El panel en sí vive por encima del enrutador, no aquí: esto solo le dice
 * «si estás acoplado, ponte en este sitio». Cuando la página desaparece
 * —el operador se fue a otra pantalla—, el anclaje se borra y el panel se
 * queda flotando, que es exactamente lo que se busca: la llamada no se cae
 * por cambiar de pantalla.
 */
@Directive({
  selector: '[appAnclajeVideollamada]',
  standalone: true,
})
export class AnclajeVideollamadaDirective implements OnDestroy {
  /** Caso que está abierto en esta página. */
  readonly appAnclajeVideollamada = input.required<string>();
  /** Teléfono que se propone para llamar; el despachador puede corregirlo. */
  readonly telefono = input<string | null>(null);

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly video = inject(VideollamadaService);

  constructor() {
    effect(() => {
      const casoId = this.appAnclajeVideollamada();
      if (!casoId) return;
      this.video.abrirPanel(casoId, this.telefono());
      this.video.anclaje.set(this.el.nativeElement);
    });
  }

  ngOnDestroy(): void {
    // Si el panel está acoplado DENTRO de este hueco, hay que sacarlo antes de
    // que el navegador se lleve la página y el nodo con ella. Por eso es una
    // llamada directa y no un efecto: los efectos se ejecutan después, y para
    // entonces el <video> ya habría salido del árbol con la llamada en curso.
    if (this.el.nativeElement.firstElementChild) this.video.devolverAFlotante()?.();

    // Solo se suelta el anclaje si este sigue siendo el vigente: al pasar de
    // un caso a otro, el nuevo ya se registró antes de que el viejo se
    // destruya, y borrarlo aquí dejaría el panel sin sitio donde acoplarse.
    if (this.video.anclaje() === this.el.nativeElement) this.video.anclaje.set(null);

    // Sin llamada viva, salir del caso cierra el panel: dejarlo flotando
    // vacío sería un estorbo. Con llamada en curso se queda, que es el motivo
    // de todo esto.
    if (!this.video.hayLlamada()) this.video.cerrarPanel();
  }
}
