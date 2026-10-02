import {
  ChangeDetectionStrategy, Component, ElementRef,
  computed, effect, input, output, signal, viewChild,
} from '@angular/core';

export const DIGITOS = 6;

/**
 * Las seis casillas del código temporal.
 *
 * Pieza aparte porque el mismo gesto ocurre en dos sitios —la ventana de
 * enrolamiento y el panel desplegable del login— y el comportamiento fino
 * (saltar de casilla, retroceder al borrar, repartir un código pegado,
 * enviar solo al completar) es justo lo que no conviene tener por duplicado.
 */
@Component({
  selector: 'app-codigo-casillas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cc" #raiz role="group" aria-label="Código de seis dígitos">
      @for (d of digitos(); track $index) {
        <input type="text" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" [attr.aria-label]="'Dígito ' + ($index + 1)"
               [class.cc--lleno]="d"
               [disabled]="deshabilitado()"
               (input)="alEscribir($index, $event)"
               (keydown)="alTeclear($index, $event)" />
      }
    </div>
  `,
  styles: `
    .cc {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 0.45rem;
    }

    input {
      width: 100%;
      padding: 0.62rem 0;
      border-radius: 10px;
      border: 1px solid var(--border-2);
      background: var(--surface);
      color: var(--ink);
      font-family: var(--mono);
      font-size: 1.3rem;
      font-weight: 600;
      text-align: center;
      /* Las transiciones son cortas a propósito: esto se teclea rápido y una
         animación lenta se siente como retraso, no como cuidado. */
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
    }

    /* Una casilla con dígito queda asentada; la vacía, a la espera. */
    input.cc--lleno {
      border-color: var(--border-2);
      background: var(--surface-2);
    }

    input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
    }

    input:disabled { opacity: 0.5; }

    @media (max-width: 400px) {
      .cc { gap: 0.3rem; }
      input { font-size: 1.1rem; padding: 0.5rem 0; }
    }
  `,
})
export class CodigoCasillasComponent {
  readonly deshabilitado = input(false);
  /** Cuando pasa a `true`, el foco va a la primera casilla vacía. */
  readonly enfocar = input(false);

  /** Se emite en cuanto hay seis dígitos: nadie debería pulsar un botón más. */
  readonly completado = output<string>();

  private readonly raiz = viewChild<ElementRef<HTMLDivElement>>('raiz');

  readonly digitos = signal<string[]>(Array(DIGITOS).fill(''));
  readonly codigo = computed(() => this.digitos().join(''));
  readonly completo = computed(() => this.codigo().length === DIGITOS);

  constructor() {
    // El foco se pide desde fuera y solo cuando las casillas ya se pueden
    // escribir: un campo deshabilitado no lo admite, y la llamada se perdería
    // sin ruido.
    effect(() => {
      if (this.enfocar() && !this.deshabilitado()) {
        const i = this.digitos().findIndex((d) => !d);
        queueMicrotask(() => this.ponerFoco(i < 0 ? 0 : i));
      }
    });
  }

  /** Vacía las casillas y vuelve al principio, tras un código rechazado. */
  limpiar(): void {
    this.digitos.set(Array(DIGITOS).fill(''));
    this.campos()?.forEach((c) => (c.value = ''));
    this.ponerFoco(0);
  }

  alEscribir(i: number, ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const valor = el.value.replace(/\D+/g, '');

    // Pegar los seis de golpe es lo que hace medio mundo: se reparten.
    if (valor.length > 1) {
      const trozos = valor.slice(0, DIGITOS).split('');
      this.digitos.update((d) => d.map((v, j) => trozos[j - i] ?? (j < i ? v : '')));
      this.sincronizar();
      this.ponerFoco(Math.min(i + trozos.length, DIGITOS - 1));
      this.avisarSiCompleto();
      return;
    }

    this.digitos.update((d) => d.map((v, j) => (j === i ? valor : v)));
    el.value = valor;
    if (valor && i < DIGITOS - 1) this.ponerFoco(i + 1);
    this.avisarSiCompleto();
  }

  alTeclear(i: number, ev: KeyboardEvent): void {
    const el = ev.target as HTMLInputElement;
    if (ev.key === 'Backspace' && !el.value && i > 0) this.ponerFoco(i - 1);
    else if (ev.key === 'ArrowLeft' && i > 0) { ev.preventDefault(); this.ponerFoco(i - 1); }
    else if (ev.key === 'ArrowRight' && i < DIGITOS - 1) { ev.preventDefault(); this.ponerFoco(i + 1); }
    else if (ev.key === 'Enter') this.avisarSiCompleto();
  }

  private avisarSiCompleto(): void {
    if (this.completo()) this.completado.emit(this.codigo());
  }

  private sincronizar(): void {
    this.campos()?.forEach((c, j) => (c.value = this.digitos()[j] ?? ''));
  }

  private campos(): HTMLInputElement[] | null {
    const el = this.raiz()?.nativeElement;
    return el ? Array.from(el.querySelectorAll('input')) : null;
  }

  private ponerFoco(i: number): void {
    this.campos()?.[i]?.focus();
  }
}
