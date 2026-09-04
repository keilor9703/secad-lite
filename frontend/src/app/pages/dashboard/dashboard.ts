import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Chart, type ChartConfiguration } from 'chart.js/auto';

import { AuthService } from '../../core/auth.service';
import { TemaService } from '../../core/tema.service';
import {
  Cumplimiento, Hallazgos, MetricasService, Ranking, Resumen, ResumenLlamadas, Tendencia,
} from '../../core/metricas.service';
import { ExportarService } from '../../core/exportar.service';

interface Barra { etiqueta: string; valor: number; clave: string; }

/** Variación frente al período anterior: cuánto cambió y si eso es una buena o mala noticia. */
interface Variacion { pct: number; direccion: 'sube' | 'baja' | 'igual'; bueno: boolean | null }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnDestroy {
  private metricas = inject(MetricasService);
  private auth = inject(AuthService);
  private exportar = inject(ExportarService);
  private tema = inject(TemaService);

  readonly resumen = signal<Resumen | null>(null);
  readonly tendencia = signal<Tendencia | null>(null);
  readonly cumplimiento = signal<Cumplimiento | null>(null);
  readonly hallazgos = signal<Hallazgos | null>(null);
  readonly ranking = signal<Ranking | null>(null);
  readonly llamadas = signal<ResumenLlamadas | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  readonly filtroForm = new FormGroup({
    desde: new FormControl('', { nonNullable: true }),
    hasta: new FormControl('', { nonNullable: true }),
  });

  exportarCsv(): void {
    const { desde, hasta } = this.filtroForm.getRawValue();
    this.exportar.descargarCasos({ desde: desde || undefined, hasta: hasta || undefined });
  }

  private readonly estadoLabels: Record<string, string> = {
    nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado',
  };
  private readonly canalLabels: Record<string, string> = {
    llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración',
  };
  /** Mismo orden fijo en el que se pintan los canales — el color identifica el canal, nunca su puesto. */
  private readonly canalOrden: string[] = ['llamada', 'chat', 'whatsapp', 'integracion'];
  private readonly estadoLlamadaLabels: Record<string, string> = {
    sonando: 'Timbrando', atendida: 'Atendidas', perdida: 'Perdidas', finalizada: 'Finalizadas',
  };

  readonly porEstado = computed<Barra[]>(() => this.aBarras(this.resumen()?.porEstado, this.estadoLabels));
  readonly porCanal = computed<Barra[]>(() => {
    const datos = this.resumen()?.porCanal;
    if (!datos) return [];
    return this.canalOrden.map((clave) => ({ clave, valor: datos[clave] ?? 0, etiqueta: this.canalLabels[clave] ?? clave }));
  });
  readonly maxAgencia = computed(() => Math.max(1, ...(this.resumen()?.porAgencia ?? []).map((a) => a.total)));
  readonly tiempos = computed(() => this.resumen()?.tiempos ?? null);
  readonly porEstadoLlamada = computed<Barra[]>(() => this.aBarras(this.llamadas()?.porEstado, this.estadoLlamadaLabels));

  readonly variacionTotal = computed<Variacion | null>(() => {
    const r = this.resumen();
    return r ? this.calcVariacion(r.total, r.periodoAnterior.total, false) : null;
  });
  readonly variacionToma = computed<Variacion | null>(() => {
    const r = this.resumen();
    const actual = r?.tiempos.global?.tomaMin;
    const anterior = r?.periodoAnterior.tiempoTomaProm;
    return actual != null && anterior != null ? this.calcVariacion(actual, anterior, true) : null;
  });

  /** Minutos → texto corto («8 min», «1 h 20 min»); null = sin casos con ese hito. */
  duracion(min: number | null): string {
    if (min === null) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${Math.round(min % 60)} min`;
  }

  prioridadLabel(p: string): string {
    return ({ alta: 'Alta', media: 'Media', baja: 'Baja' } as Record<string, string>)[p] ?? p;
  }

  /** Franja de color del cumplimiento: >=80% cumple, >=50% en riesgo, el resto crítico. */
  estadoCumplimiento(pct: number | null): 'ok' | 'warn' | 'critico' | 'sin-datos' {
    if (pct === null) return 'sin-datos';
    if (pct >= 80) return 'ok';
    if (pct >= 50) return 'warn';
    return 'critico';
  }

  /** aaaa-mm-dd → dd/mm, para las etiquetas del eje del gráfico de tendencia. */
  fechaCorta(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  private calcVariacion(actual: number, anterior: number, mejorSiBaja: boolean): Variacion | null {
    if (anterior <= 0) return null;
    const delta = actual - anterior;
    const pct = Math.round((Math.abs(delta) / anterior) * 1000) / 10;
    const direccion: Variacion['direccion'] = pct < 0.1 ? 'igual' : delta > 0 ? 'sube' : 'baja';
    const bueno = direccion === 'igual' ? null : mejorSiBaja ? direccion === 'baja' : direccion === 'sube';
    return { pct, direccion, bueno };
  }

  // --- Gráfico de tendencia (Chart.js) --------------------------------------
  private readonly canvasTendencia = viewChild<ElementRef<HTMLCanvasElement>>('canvasTendencia');
  private chart?: Chart;

  constructor() {
    // Las métricas son del tenant activo (ver RecepcionComponent).
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
    });
    // Redibuja cuando llegan datos nuevos, cuando el canvas recién se monta
    // (el bloque @if espera a que carguen las métricas) o al cambiar de tema
    // — los colores se leen de las variables CSS, que cambian con el tema.
    effect(() => {
      const el = this.canvasTendencia();
      const t = this.tendencia();
      this.tema.efectivo();
      if (el && t) this.dibujarTendencia(el.nativeElement, t);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    const { desde, hasta } = this.filtroForm.getRawValue();
    const filtro = { desde: desde || undefined, hasta: hasta || undefined };

    this.metricas.resumen(filtro).subscribe({
      next: (r) => { this.resumen.set(r); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar las métricas.'); this.cargando.set(false); },
    });
    this.metricas.tendencia(filtro).subscribe({ next: (t) => this.tendencia.set(t), error: () => {} });
    this.metricas.cumplimiento(filtro).subscribe({ next: (c) => this.cumplimiento.set(c), error: () => {} });
    this.metricas.hallazgos(filtro).subscribe({ next: (h) => this.hallazgos.set(h), error: () => {} });
    this.metricas.ranking(filtro).subscribe({ next: (r) => this.ranking.set(r), error: () => {} });
    // Aparte: si la planta telefónica no está en uso, este reporte igual
    // carga (con conteos en cero) sin bloquear el resto del panel.
    this.metricas.llamadas().subscribe({
      next: (r) => this.llamadas.set(r),
      error: () => {},
    });
  }

  aplicarFechas(): void {
    const { desde, hasta } = this.filtroForm.getRawValue();
    if (desde && hasta && desde > hasta) this.filtroForm.patchValue({ desde: hasta, hasta: desde });
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filtroForm.reset({ desde: '', hasta: '' });
    this.cargar();
  }

  /** Porcentaje relativo al total de la serie, para el ancho de la barra. */
  pct(valor: number, serie: Barra[]): number {
    const max = Math.max(1, ...serie.map((b) => b.valor));
    return Math.round((valor / max) * 100);
  }

  private aBarras(datos: Record<string, number> | undefined, labels: Record<string, string>): Barra[] {
    if (!datos) return [];
    return Object.entries(datos).map(([clave, valor]) => ({ clave, valor, etiqueta: labels[clave] ?? clave }));
  }

  private variable(nombre: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  }

  private dibujarTendencia(canvas: HTMLCanvasElement, t: Tendencia): void {
    const colorActual = this.variable('--serie-teal');
    const colorAnterior = this.variable('--muted');
    const ink = this.variable('--ink-soft');
    const grid = this.variable('--border');

    const data: ChartConfiguration<'line'>['data'] = {
      labels: t.actual.map((p) => this.fechaCorta(p.fecha)),
      datasets: [
        {
          label: 'Período actual',
          data: t.actual.map((p) => p.total),
          borderColor: colorActual,
          backgroundColor: colorActual + '26',
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: 'Período anterior',
          data: t.anterior.map((p) => p.total),
          borderColor: colorAnterior,
          borderDash: [5, 4],
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 1.5,
        },
      ],
    };

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: ink, boxWidth: 12, usePointStyle: true, pointStyle: 'line' } },
          tooltip: { titleColor: '#fff', bodyColor: '#fff' },
        },
        scales: {
          x: { ticks: { color: ink }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } },
        },
      },
    };

    if (this.chart) {
      this.chart.data = data;
      this.chart.options = config.options!;
      this.chart.update();
    } else {
      this.chart = new Chart(canvas, config);
    }
  }
}
