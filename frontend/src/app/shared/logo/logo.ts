import { Component, Input } from '@angular/core';

/**
 * Marca FALCON CAD: el halcón geométrico, dibujado en SVG para que se vea
 * nítido a cualquier tamaño y herede el color de fondo de la interfaz.
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    <svg [attr.width]="tam" [attr.height]="tam" viewBox="0 0 64 64" role="img"
         [attr.aria-label]="etiqueta">
      <defs>
        <linearGradient [attr.id]="idTeal" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stop-color="#7CEDF3"/>
          <stop offset="0.5" stop-color="#2BC4D4"/>
          <stop offset="1" stop-color="#0A88A0"/>
        </linearGradient>
        <linearGradient [attr.id]="idOscuro" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#23577F"/>
          <stop offset="1" stop-color="#0A1E33"/>
        </linearGradient>
      </defs>
      <!-- ala: borde exterior hasta la punta y regreso en zigzag (plumas) -->
      <path [attr.fill]="'url(#' + idTeal + ')'" d="M40 28 L5 2 L18 21 L2 11 L15 29 L3 23 L22 40 Z"/>
      <path [attr.fill]="'url(#' + idOscuro + ')'" d="M40 28 L5 2 L18 21 Z"/>
      <path [attr.fill]="'url(#' + idOscuro + ')'" d="M40 28 L18 21 L15 29 Z" opacity="0.8"/>
      <!-- cuerpo y cola -->
      <path [attr.fill]="'url(#' + idTeal + ')'" d="M40 28 L48 25 L34 41 L7 60 L22 40 Z"/>
      <path [attr.fill]="'url(#' + idOscuro + ')'" d="M40 28 L48 25 L35 40 Z"/>
      <!-- cabeza y pico -->
      <path [attr.fill]="'url(#' + idOscuro + ')'" d="M42 30 L50 13 L63 20 L53 29 Z"/>
      <path [attr.fill]="'url(#' + idTeal + ')'" d="M50 13 L63 20 L55 20 Z"/>
      <path [attr.fill]="'url(#' + idOscuro + ')'" d="M63 20 L56 18 L57 25 Z"/>
      <!-- quiebre en negativo: toma el color del fondo donde se coloque -->
      <path [attr.fill]="fondo" d="M21 35 L33 30 L26 41 Z" opacity="0.95"/>
    </svg>
  `,
  styles: [`:host { display: inline-flex; line-height: 0; }`],
})
export class LogoComponent {
  /** Lado del cuadro en píxeles. */
  @Input() tam = 32;
  /** Color del quiebre interno; debe coincidir con el fondo donde va la marca. */
  @Input() fondo = 'var(--surface)';
  @Input() etiqueta = 'FALCON CAD';

  // Los degradados se referencian por id, así que cada instancia usa el suyo
  // para no colisionar cuando hay varias marcas en la misma página.
  private static contador = 0;
  private readonly n = ++LogoComponent.contador;
  readonly idTeal = `fc-teal-${this.n}`;
  readonly idOscuro = `fc-dark-${this.n}`;
}
