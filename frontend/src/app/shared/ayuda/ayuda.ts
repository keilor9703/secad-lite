import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * El signo "?" que explica un reporte, una columna o una fila al pasar el
 * mouse (o al enfocarlo con teclado). Solo CSS — sin JS de posicionamiento —
 * así que el texto no puede ser larguísimo; para eso está `texto()`.
 */
@Component({
  selector: 'app-ayuda',
  standalone: true,
  template: `
    <span class="ayuda" tabindex="0" [attr.aria-label]="texto()">
      <span class="ayuda-icono" aria-hidden="true">?</span>
      <span class="ayuda-globo" role="tooltip">{{ texto() }}</span>
    </span>
  `,
  styleUrl: './ayuda.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AyudaComponent {
  readonly texto = input.required<string>();
}
