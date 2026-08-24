import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { Canal, Caso, EstadoCaso, PrioridadCaso } from '../../core/models';

/**
 * Consulta y seguimiento: la bandeja completa con búsqueda. Es la vista de
 * quien supervisa, no la de quien recepciona ni la de quien despacha — esos
 * tienen sus propios módulos, con lo que cada uno necesita a la mano.
 */
@Component({
  selector: 'app-casos',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './casos.html',
  styleUrl: './casos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CasosComponent {
  private casosSvc = inject(CasosService);
  private auth = inject(AuthService);

  readonly casos = signal<Caso[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly veTodo = computed(() => this.auth.tienePermiso('casos.ver_todos'));

  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];
  readonly prioridades: PrioridadCaso[] = ['alta', 'media', 'baja'];
  private readonly busqueda = signal('');
  private readonly estadoFiltro = signal<EstadoCaso | ''>('');
  private readonly prioridadFiltro = signal<PrioridadCaso | ''>('');
  /** Rango por fecha de recepción; se aplica en el SERVIDOR al recargar. */
  readonly filtroForm = new FormGroup({
    texto: new FormControl('', { nonNullable: true }),
    estadoSel: new FormControl<EstadoCaso | ''>('', { nonNullable: true }),
    prioridadSel: new FormControl<PrioridadCaso | ''>('', { nonNullable: true }),
    desde: new FormControl('', { nonNullable: true }),
    hasta: new FormControl('', { nonNullable: true }),
  });

  readonly filtrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const e = this.estadoFiltro();
    const p = this.prioridadFiltro();
    return this.casos().filter((c) => {
      if (e && c.estado !== e) return false;
      if (p && c.prioridad !== p) return false;
      if (!q) return true;
      return [c.titulo, c.ciudadano, c.direccion, c.barrio, c.codigoCaso, c.agencia]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  });

  constructor() {
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
    });
    this.filtroForm.controls.texto.valueChanges.subscribe((v) => this.busqueda.set(v));
    this.filtroForm.controls.estadoSel.valueChanges.subscribe((v) => this.estadoFiltro.set(v));
    this.filtroForm.controls.prioridadSel.valueChanges.subscribe((v) => this.prioridadFiltro.set(v));
  }

  /** El rango de fechas cambia el conjunto: se vuelve a pedir al servidor. */
  aplicarFechas(): void {
    const { desde, hasta } = this.filtroForm.getRawValue();
    if (desde && hasta && desde > hasta) {
      this.error.set('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    this.cargar();
  }

  limpiarFechas(): void {
    this.filtroForm.patchValue({ desde: '', hasta: '' });
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    const { desde, hasta } = this.filtroForm.getRawValue();
    this.casosSvc.listar({ limite: 500, desde: desde || undefined, hasta: hasta || undefined }).subscribe({
      next: (cs) => { this.casos.set(cs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar los casos.'); this.cargando.set(false); },
    });
  }

  /**
   * Exporta lo que se está viendo (con los filtros aplicados) a CSV, para el
   * informe o la hoja de cálculo. Con BOM para que Excel respete las tildes,
   * y con comillas escapadas para que un título con ; o " no rompa filas.
   */
  exportarCsv(): void {
    const cols = ['Código', 'Motivo', 'Canal', 'Ciudadano', 'Teléfono', 'Dirección', 'Barrio', 'Ciudad',
                  'Agencia', 'Prioridad', 'Estado', 'Recepcionado por', 'Recepcionado en'];
    const celda = (v: unknown) => {
      let s = String(v ?? '');
      // Un valor que empieza por = + - @ lo interpretaría Excel como fórmula.
      if (/^[=+\-@]/.test(s)) s = `'` + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const filas = this.filtrados().map((c) => [
      c.codigoCaso, c.titulo, c.canal, c.ciudadano, c.telefono, c.direccion, c.barrio, c.ciudad,
      c.agencia, c.prioridad, this.estadoLabel(c.estado), c.creadoPor,
      new Date(c.creadoEn).toLocaleString('es-CO'),
    ].map(celda).join(';'));
    const csv = [cols.map(celda).join(';'), ...filas].join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `casos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c] ?? '•';
  }
  estadoLabel(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }
}
