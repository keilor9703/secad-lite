import { ChangeDetectionStrategy, Component, computed, effect, forwardRef, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

interface Celda {
  fecha: Date;
  enMes: boolean;
  iso: string;
}

let contador = 0;

/**
 * Reemplazo de <input type="date">: el selector de fecha nativo lo dibuja el
 * sistema operativo/navegador (mismo motivo que el <select> — no se puede
 * re-estilar desde CSS en ningún navegador), así que este componente dibuja
 * su propio calendario con los tokens de diseño de la app.
 *
 * El valor que entra/sale es el mismo formato que un <input type="date">:
 * una fecha ISO "aaaa-mm-dd", o "" cuando no hay ninguna elegida — así se
 * usa igual con formControlName/[formControl]/[ngModel], y también con
 * [valorActual]/(cambio) para el único caso sin formulario reactivo.
 */
@Component({
  selector: 'app-fecha',
  standalone: true,
  imports: [],
  templateUrl: './fecha.html',
  styleUrl: './fecha.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.id]': 'null' },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => FechaComponent), multi: true },
  ],
})
export class FechaComponent implements ControlValueAccessor {
  readonly id = input<string>(`fecha-${++contador}`);
  readonly ariaLabel = input<string | null>(null);
  readonly placeholder = input('dd/mm/aaaa');
  /** Para usar el control sin formularios reactivos (p. ej. «Vence» en Plataforma). */
  readonly valorActual = input<string | null | undefined>(undefined);
  readonly cambio = output<string | null>();
  readonly disabled = input(false);

  readonly abierto = signal(false);
  readonly valorActivo = signal('');
  /** Primer día del mes que se está mostrando en la grilla. */
  readonly mesVisible = signal(this.iniciarMes(new Date()));
  private readonly deshabilitadoCva = signal(false);
  readonly deshabilitadoEfectivo = computed(() => this.disabled() || this.deshabilitadoCva());

  private cvaActivo = false;
  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor() {
    effect(() => {
      if (!this.cvaActivo) this.valorActivo.set(this.valorActual() ?? '');
    });
  }

  readonly etiquetaMes = computed(() => {
    const m = this.mesVisible();
    const nombre = MESES[m.getMonth()];
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${m.getFullYear()}`;
  });

  readonly diasSemana = DIAS_SEMANA;

  readonly celdas = computed<Celda[]>(() => {
    const base = this.mesVisible();
    const año = base.getFullYear();
    const mes = base.getMonth();
    const primerDiaSemana = (new Date(año, mes, 1).getDay() + 6) % 7; // lunes = 0
    const diasEnMes = new Date(año, mes + 1, 0).getDate();
    const celdas: Celda[] = [];
    for (let i = primerDiaSemana; i > 0; i--) {
      const f = new Date(año, mes, 1 - i);
      celdas.push({ fecha: f, enMes: false, iso: this.aIso(f) });
    }
    for (let d = 1; d <= diasEnMes; d++) {
      const f = new Date(año, mes, d);
      celdas.push({ fecha: f, enMes: true, iso: this.aIso(f) });
    }
    while (celdas.length < 42) {
      const ultima = celdas[celdas.length - 1].fecha;
      const f = new Date(ultima.getFullYear(), ultima.getMonth(), ultima.getDate() + 1);
      celdas.push({ fecha: f, enMes: false, iso: this.aIso(f) });
    }
    return celdas;
  });

  readonly hoyIso = this.aIso(new Date());

  readonly etiquetaActual = computed(() => {
    const v = this.valorActivo();
    if (!v) return '';
    const f = this.deIso(v);
    return f ? this.formatoCorto(f) : '';
  });

  writeValue(v: string | null): void {
    this.cvaActivo = true;
    this.valorActivo.set(v ?? '');
    const f = v ? this.deIso(v) : null;
    this.mesVisible.set(this.iniciarMes(f ?? new Date()));
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitadoCva.set(deshabilitado);
  }

  alternar(): void {
    if (this.deshabilitadoEfectivo()) return;
    if (this.abierto()) {
      this.cerrar();
      return;
    }
    const actual = this.valorActivo();
    this.mesVisible.set(this.iniciarMes(actual ? (this.deIso(actual) ?? new Date()) : new Date()));
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  onFocusOut(): void {
    this.onTouched();
    this.cerrar();
  }

  elegir(c: Celda): void {
    if (!c.enMes) this.mesVisible.set(this.iniciarMes(c.fecha));
    this.valorActivo.set(c.iso);
    this.onChange(c.iso);
    this.cambio.emit(c.iso);
    this.cerrar();
  }

  hoy(): void {
    const iso = this.hoyIso;
    this.valorActivo.set(iso);
    this.mesVisible.set(this.iniciarMes(new Date()));
    this.onChange(iso);
    this.cambio.emit(iso);
    this.cerrar();
  }

  limpiar(): void {
    this.valorActivo.set('');
    this.onChange('');
    this.cambio.emit(null);
    this.cerrar();
  }

  mesAnterior(): void {
    const m = this.mesVisible();
    this.mesVisible.set(new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }
  mesSiguiente(): void {
    const m = this.mesVisible();
    this.mesVisible.set(new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      this.cerrar();
    } else if (ev.key === 'Enter' && !this.abierto()) {
      ev.preventDefault();
      this.alternar();
    }
  }

  private iniciarMes(f: Date): Date {
    return new Date(f.getFullYear(), f.getMonth(), 1);
  }

  private aIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private deIso(iso: string): Date | null {
    const partes = iso.split('-').map(Number);
    if (partes.length !== 3 || partes.some((n) => Number.isNaN(n))) return null;
    const [y, m, d] = partes;
    return new Date(y, m - 1, d);
  }

  private formatoCorto(f: Date): string {
    const d = String(f.getDate()).padStart(2, '0');
    const m = String(f.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${f.getFullYear()}`;
  }
}
