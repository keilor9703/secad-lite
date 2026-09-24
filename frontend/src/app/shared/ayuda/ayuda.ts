import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * El signo "?" que explica un reporte, una columna o una fila al pasar el
 * mouse (o al enfocarlo con teclado). Solo CSS — sin JS de posicionamiento —
 * así que el texto no puede ser larguísimo; para eso está `texto()`.
 *
 * `direccion="abajo"` es para cuando el ícono vive dentro de un contenedor
 * con scroll propio (p. ej. el encabezado de una tabla en `.tbl-wrap`):
 * el globo hacia arriba queda recortado por ese `overflow`, así que se
 * abre hacia abajo, donde el propio contenedor sí tiene espacio.
 */
@Component({
  selector: 'app-ayuda',
  standalone: true,
  template: `
    <span class="ayuda" [class.abajo]="direccion() === 'abajo'" tabindex="0" [attr.aria-label]="texto()">
      <span class="ayuda-icono" aria-hidden="true">?</span>
      <span class="ayuda-globo" role="tooltip">{{ texto() }}</span>
    </span>
  `,
  styleUrl: './ayuda.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AyudaComponent {
  readonly texto = input.required<string>();
  readonly direccion = input<'arriba' | 'abajo'>('arriba');
}
