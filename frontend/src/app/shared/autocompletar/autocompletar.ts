import { ChangeDetectionStrategy, Component, forwardRef, input, output, signal, computed } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface OpcionAutocompletar {
  valor: string;
  etiqueta: string;
  /** Texto secundario, más tenue (p. ej. la descripción de un código). */
  detalle?: string;
}

let contador = 0;

/**
 * Campo de texto con lista desplegable propia (no el <datalist> nativo del
 * navegador, cuyo estilo no se puede tocar y varía de un navegador a otro).
 * Filtra las opciones mientras se escribe, por etiqueta o detalle, sin
 * acentos ni mayúsculas. Implementa ControlValueAccessor: se usa igual que
 * un <input> dentro de un formulario reactivo (`formControlName`), y el
 * mismo componente sirve para cualquier lista del sistema — la idea es que
 * todos los desplegables se vean y se comporten igual.
 */
@Component({
  selector: 'app-autocompletar',
  standalone: true,
  imports: [],
  templateUrl: './autocompletar.html',
  styleUrl: './autocompletar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `id="fcod"` en la etiqueta del componente igual queda como atributo
  // plano en el host (así reflejan los atributos estáticos en Angular,
  // aparte de que además alimenten el input `id`). Sin esto, el DOM
  // terminaría con dos elementos con el mismo id — el host Y el <input> de
  // adentro — que es HTML inválido y rompe cualquier `label for=`/selector
  // que espere un solo elemento con ese id.
  host: { '[attr.id]': 'null' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AutocompletarComponent), multi: true },
  ],
})
export class AutocompletarComponent implements ControlValueAccessor {
  readonly opciones = input<OpcionAutocompletar[]>([]);
  readonly placeholder = input('');
  /** Cuántas filas mostrar como máximo (evita listas gigantes cuando el catálogo es grande). */
  readonly limite = input(50);
  /** Para un buscador que solo sirve para elegir (no queda como valor del campo): lo vacía tras seleccionar. */
  readonly limpiarAlSeleccionar = input(false);
  /**
   * `id` va al <input> real de adentro, no al host — así un <label for="…">
   * de afuera lo enfoca igual que con un <input> nativo. Se toma este nombre
   * a propósito (en vez de dejar que Angular lo trate como atributo suelto
   * del host) para que `<app-autocompletar id="fcod">` funcione tal cual.
   */
  readonly id = input<string>(`ac-${++contador}`);

  /** Se dispara al elegir una opción de la lista (clic o Enter). */
  readonly seleccionado = output<OpcionAutocompletar>();
  /** Al perder el foco — para quien quiera reaccionar igual que con (change) en un input nativo. */
  readonly desenfoque = output<void>();

  readonly texto = signal('');
  readonly abierto = signal(false);
  readonly indiceActivo = signal(-1);
  readonly deshabilitado = signal(false);

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  readonly filtradas = computed(() => {
    const q = this.normalizar(this.texto());
    const opts = this.opciones();
    const coincide = q
      ? opts.filter((o) => this.normalizar(o.etiqueta).includes(q) || this.normalizar(o.detalle ?? '').includes(q))
      : opts;
    return coincide.slice(0, this.limite());
  });

  writeValue(v: string | null): void {
    this.texto.set(v ?? '');
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }

  onInput(v: string): void {
    this.texto.set(v);
    this.onChange(v);
    this.indiceActivo.set(-1);
    this.abierto.set(true);
  }

  onFocus(): void {
    this.abierto.set(true);
  }

  onFocusOut(): void {
    this.onTouched();
    this.abierto.set(false);
    this.indiceActivo.set(-1);
    this.desenfoque.emit();
  }

  elegir(o: OpcionAutocompletar): void {
    const nuevoTexto = this.limpiarAlSeleccionar() ? '' : o.etiqueta;
    this.texto.set(nuevoTexto);
    this.onChange(nuevoTexto);
    this.abierto.set(false);
    this.indiceActivo.set(-1);
    this.seleccionado.emit(o);
  }

  onKeydown(ev: KeyboardEvent): void {
    const filas = this.filtradas();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (!filas.length) return;
      this.abierto.set(true);
      this.indiceActivo.set(Math.min(this.indiceActivo() + 1, filas.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!filas.length) return;
      this.indiceActivo.set(Math.max(this.indiceActivo() - 1, 0));
    } else if (ev.key === 'Enter') {
      const i = this.indiceActivo();
      if (i >= 0 && filas[i]) {
        ev.preventDefault();
        this.elegir(filas[i]);
      }
    } else if (ev.key === 'Escape') {
      this.abierto.set(false);
      this.indiceActivo.set(-1);
    }
  }

  optionId(i: number): string {
    return `${this.id()}-opt-${i}`;
  }

  /** Minúsculas y sin acentos, para comparar como habla la gente. */
  private normalizar(t: string): string {
    return (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
}
