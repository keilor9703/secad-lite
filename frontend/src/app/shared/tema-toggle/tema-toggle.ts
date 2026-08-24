import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Tema, TemaService } from '../../core/tema.service';

interface Opcion { valor: Tema; icono: string; titulo: string; }

/** Selector de apariencia: claro, oscuro o el del sistema. */
@Component({
  selector: 'app-tema-toggle',
  standalone: true,
  imports: [],
  template: `
    <div class="tema" role="group" aria-label="Tema de color">
      @for (o of opciones; track o) {
        <button type="button" [title]="o.titulo"
          [attr.aria-label]="o.titulo" [attr.aria-pressed]="tema.preferencia() === o.valor"
          [class.on]="tema.preferencia() === o.valor" (click)="tema.elegir(o.valor)">
          {{ o.icono }}
        </button>
      }
    </div>
    `,
  styles: [`
    .tema { display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px;
            border: 1px solid var(--border); background: var(--surface-2); }
    button { border: none; background: transparent; cursor: pointer; line-height: 1;
             padding: 0.25rem 0.4rem; border-radius: 999px; font-size: 0.85rem;
             filter: grayscale(1); opacity: 0.65; }
    button:hover { opacity: 1; }
    button.on { background: var(--surface); filter: none; opacity: 1;
                box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemaToggleComponent {
  readonly tema = inject(TemaService);
  readonly opciones: Opcion[] = [
    { valor: 'claro', icono: '☀️', titulo: 'Modo claro' },
    { valor: 'oscuro', icono: '🌙', titulo: 'Modo oscuro' },
    { valor: 'sistema', icono: '💻', titulo: 'Según el sistema' },
  ];
}
