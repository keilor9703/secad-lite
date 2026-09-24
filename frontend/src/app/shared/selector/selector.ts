import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  ElementRef,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { OpcionComponent, SELECTOR_HOST } from './opcion';

let contador = 0;

/**
 * Reemplazo de <select>: se ve igual (misma caja, borde y flecha que el
 * resto de los campos) pero la lista que despliega la dibuja esta misma
 * app en vez de dejar que el navegador dibuje su propio popup — el popup
 * nativo de un <select> no se puede re-estilar desde CSS en ningún
 * navegador, por eso siempre desentonaba del resto del diseño.
 *
 * Se usa como un <select>: opciones como <app-opcion [valor]="x">texto
 * </app-opcion> dentro, y funciona con formControlName/[formControl]/
 * [ngModel] (implementa ControlValueAccessor). Para el puñado de casos que
 * no usan formularios reactivos, también admite [valorActual]/(cambio).
 *
 * Al abrirse trae su propio buscador (filtra las opciones mientras se
 * escribe, sin acentos ni mayúsculas) — imprescindible en listas largas
 * (departamentos, agencias, tenants…), y gratis en las cortas.
 */
@Component({
  selector: 'app-selector',
  standalone: true,
  imports: [],
  templateUrl: './selector.html',
  styleUrl: './selector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Mismo motivo que en app-autocompletar: el id declarado en la etiqueta
  // del componente va al botón real de adentro, no al host, para no
  // duplicar el id en el DOM y para que un <label for="…"> externo enfoque
  // el control real.
  host: { '[attr.id]': 'null' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectorComponent), multi: true },
    { provide: SELECTOR_HOST, useExisting: forwardRef(() => SelectorComponent) },
  ],
})
export class SelectorComponent implements ControlValueAccessor {
  readonly id = input<string>(`sel-${++contador}`);
  readonly ariaLabel = input<string | null>(null);
  /** Para usar el control sin formularios reactivos (p. ej. el selector de tenant). */
  readonly valorActual = input<unknown>(undefined);
  readonly cambio = output<unknown>();
  /** Para deshabilitarlo por atributo directo (p. ej. junto a [ngModel], sin formulario reactivo). */
  readonly disabled = input(false);
  /**
   * Selección múltiple: el valor pasa a ser un arreglo, cada clic
   * agrega/quita del arreglo en vez de reemplazar y elegir la lista, y la
   * lista no se cierra sola al elegir (hay que poder marcar varias).
   */
  readonly multiple = input(false);
  /** Cuántos nombres se listan antes de resumir en "N seleccionados" (modo múltiple). */
  readonly resumenDesde = input(3);
  readonly placeholder = input('Seleccionar…');

  readonly opciones = contentChildren(OpcionComponent);

  readonly abierto = signal(false);
  readonly indiceActivo = signal(-1);
  readonly valorActivo = signal<unknown>(undefined);
  readonly busqueda = signal('');
  private readonly deshabilitadoCva = signal(false);
  readonly deshabilitado = computed(() => this.disabled() || this.deshabilitadoCva());
  readonly hayVisibles = computed(() => this.opciones().some((o) => !o.oculta()));

  private readonly elRef = inject(ElementRef<HTMLElement>);
  private readonly campoBusqueda = viewChild<ElementRef<HTMLInputElement>>('campoBusqueda');

  private cvaActivo = false;
  private onChange: (v: unknown) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    // Sin CVA (sin formControlName/[formControl]/[ngModel]) el valor lo
    // manda quien use el componente a través de [valorActual]; con CVA,
    // writeValue() manda y esto queda sin efecto.
    effect(() => {
      if (!this.cvaActivo) this.valorActivo.set(this.valorActual());
    });
    // Foco automático al buscador apenas se abre, para poder escribir de una.
    effect(() => {
      if (this.abierto()) this.campoBusqueda()?.nativeElement.focus();
    });
  }

  private texto(valor: unknown): string {
    const opcion = this.opciones().find((o) => o.valor() === valor);
    return opcion ? (opcion.elementRef.nativeElement.textContent ?? '').trim() : '';
  }

  readonly etiquetaActual = computed(() => {
    if (this.multiple()) {
      const arr = (this.valorActivo() as unknown[] | undefined) ?? [];
      if (!arr.length) return this.placeholder();
      if (arr.length <= this.resumenDesde()) return arr.map((v) => this.texto(v)).join(', ');
      return `${arr.length} seleccionados`;
    }
    return this.texto(this.valorActivo());
  });

  writeValue(v: unknown): void {
    this.cvaActivo = true;
    this.valorActivo.set(this.multiple() ? (Array.isArray(v) ? v : []) : v);
  }
  registerOnChange(fn: (v: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitadoCva.set(deshabilitado);
  }

  estaSeleccionado(valor: unknown): boolean {
    if (this.multiple()) return ((this.valorActivo() as unknown[] | undefined) ?? []).includes(valor);
    return this.valorActivo() === valor;
  }

  elegir(valor: unknown): void {
    if (this.multiple()) {
      const actual = (this.valorActivo() as unknown[] | undefined) ?? [];
      const nuevo = actual.includes(valor) ? actual.filter((v) => v !== valor) : [...actual, valor];
      this.valorActivo.set(nuevo);
      this.onChange(nuevo);
      this.cambio.emit(nuevo);
      // Se deja abierta: elegir varias es justo el punto de este modo.
      return;
    }
    this.valorActivo.set(valor);
    this.onChange(valor);
    this.cambio.emit(valor);
    this.cerrar();
  }

  alternar(): void {
    if (this.deshabilitado()) return;
    this.abierto() ? this.cerrar() : this.abrir();
  }

  abrir(): void {
    if (this.deshabilitado()) return;
    this.abierto.set(true);
    this.indiceActivo.set(this.opciones().findIndex((o) => o.valor() === this.valorActivo()));
  }

  cerrar(): void {
    this.abierto.set(false);
    this.indiceActivo.set(-1);
    this.busqueda.set('');
  }

  onBuscar(v: string): void {
    this.busqueda.set(v);
    this.indiceActivo.set(-1);
  }

  /** Cierra solo si el foco de verdad salió del componente (no si se movió del botón al buscador). */
  onFocusOut(ev: FocusEvent): void {
    const siguiente = ev.relatedTarget as Node | null;
    if (siguiente && this.elRef.nativeElement.contains(siguiente)) return;
    this.onTouched();
    this.cerrar();
  }

  private elegible(o: OpcionComponent): boolean {
    return !o.deshabilitada() && !o.oculta();
  }

  /**
   * Compartida entre el botón y el buscador. El espacio no se intercepta
   * aquí a propósito: en el botón lo abre el propio <button> nativo (que ya
   * dispara click solo con Enter/Espacio) y en el buscador tiene que poder
   * escribirse.
   */
  onKeydown(ev: KeyboardEvent): void {
    const filas = this.opciones();
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!this.abierto()) {
        this.abrir();
        return;
      }
      if (!filas.length) return;
      const paso = ev.key === 'ArrowDown' ? 1 : -1;
      let i = this.indiceActivo();
      for (let n = 0; n < filas.length; n++) {
        i = (i + paso + filas.length) % filas.length;
        if (this.elegible(filas[i])) break;
      }
      this.indiceActivo.set(i);
    } else if (ev.key === 'Enter') {
      if (!this.abierto()) {
        ev.preventDefault();
        this.abrir();
        return;
      }
      const i = this.indiceActivo();
      if (i >= 0 && filas[i] && this.elegible(filas[i])) {
        ev.preventDefault();
        this.elegir(filas[i].valor());
      }
    } else if (ev.key === 'Escape') {
      this.cerrar();
    } else if (ev.key === 'Home' && this.abierto()) {
      ev.preventDefault();
      this.indiceActivo.set(filas.findIndex((o) => this.elegible(o)));
    } else if (ev.key === 'End' && this.abierto()) {
      ev.preventDefault();
      for (let i = filas.length - 1; i >= 0; i--) {
        if (this.elegible(filas[i])) {
          this.indiceActivo.set(i);
          break;
        }
      }
    }
  }

  optionId(i: number): string {
    return `${this.id()}-opt-${i}`;
  }
}
