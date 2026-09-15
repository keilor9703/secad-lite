import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, InjectionToken, input } from '@angular/core';

/**
 * Lo que <app-opcion> necesita de su <app-selector> contenedor. Se expone
 * como token en vez de inyectar la clase concreta directamente para no
 * crear un import circular entre este archivo y selector.ts (cada uno
 * necesita al otro: éste para hablarle a su selector, aquél para poder
 * hacer `contentChildren(OpcionComponent)`).
 */
export interface SelectorHost {
  readonly valorActivo: () => unknown;
  readonly indiceActivo: () => number;
  opciones(): readonly OpcionComponent[];
  optionId(i: number): string;
  elegir(valor: unknown): void;
}
export const SELECTOR_HOST = new InjectionToken<SelectorHost>('selector-host');

/**
 * Una opción de <app-selector>. Se escribe igual que un <option> nativo
 * (`<app-opcion [valor]="x">Etiqueta</app-opcion>`) pero es el propio
 * <app-selector> quien la dibuja como fila de su lista — este componente
 * solo aporta el valor/estado y el texto proyectado.
 */
@Component({
  selector: 'app-opcion',
  standalone: true,
  template: `<ng-content></ng-content>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'option',
    class: 'sel-opcion',
    '[class.activa]': 'activa()',
    '[class.resaltada]': 'resaltada()',
    '[class.deshabilitada]': 'deshabilitada()',
    '[id]': 'idOpcion()',
    '[attr.aria-selected]': 'activa()',
    '[attr.aria-disabled]': 'deshabilitada() || null',
    '(click)': 'onClick()',
    '(mousedown)': '$event.preventDefault()',
  },
})
export class OpcionComponent {
  readonly valor = input<unknown>(undefined);
  readonly deshabilitada = input(false);

  readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly selector = inject(SELECTOR_HOST);

  readonly activa = computed(() => !this.deshabilitada() && this.selector.valorActivo() === this.valor());
  private readonly indice = computed(() => this.selector.opciones().indexOf(this));
  readonly resaltada = computed(() => this.selector.indiceActivo() === this.indice());
  readonly idOpcion = computed(() => this.selector.optionId(this.indice()));

  onClick(): void {
    if (this.deshabilitada()) return;
    this.selector.elegir(this.valor());
  }
}
