import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { Chart, type ChartConfiguration } from 'chart.js/auto';
import {
  Adopcion, Cartera, EntradaBitacoraGlobal, Infraestructura, Medida, MonitorService, Salud, Uso,
} from '../../core/monitor.service';
import { TemaService } from '../../core/tema.service';

/** Cómo se pinta un indicador: verde tranquilo, ámbar que avisa, rojo que exige. */
type Semaforo = 'ok' | 'aviso' | 'critico' | 'neutro';

/**
 * Monitor de la plataforma: la consola del dueño de FALCON CAD sobre su propio
 * sistema. Responde, en una pantalla, las cuatro preguntas que antes obligaban
 * a entrar a la base de datos a mano: ¿está sano el servidor?, ¿cómo va la
 * cartera de municipios?, ¿cuánto se usa de verdad?, ¿qué módulos se pagan y
 * no se tocan?
 *
 * Es distinto del módulo Plataforma, que da de alta instancias y gobierna su
 * suscripción: aquí no se cambia nada, solo se mira.
 */
@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [],
  templateUrl: './monitor.html',
  styleUrl: './monitor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MonitorComponent implements OnDestroy {
  private monitor = inject(MonitorService);
  private tema = inject(TemaService);

  readonly salud = signal<Salud | null>(null);
  readonly infra = signal<Infraestructura | null>(null);
  readonly cartera = signal<Cartera | null>(null);
  readonly uso = signal<Uso | null>(null);
  readonly adopcion = signal<Adopcion | null>(null);
  readonly bitacora = signal<EntradaBitacoraGlobal[]>([]);
  readonly error = signal('');
  readonly actualizado = signal<Date | null>(null);

  private readonly temporizadores: ReturnType<typeof setInterval>[] = [];

  constructor() {
    this.cargarSalud();
    this.cargarPanorama();

    // Dos cadencias distintas a propósito. La salud es barata y es lo que
    // cambia de un momento a otro; el panorama recorre cada instancia por
    // separado (lo exige el aislamiento por RLS) y se cachea un minuto en el
    // servidor, así que pedirlo seguido no traería nada nuevo y sí costaría.
    this.temporizadores.push(setInterval(() => { if (!document.hidden) this.cargarSalud(); }, 15_000));
    this.temporizadores.push(setInterval(() => { if (!document.hidden) this.cargarPanorama(); }, 300_000));

    // Redibuja al llegar datos, al montarse el canvas y al cambiar de tema:
    // los colores salen de las variables CSS, que cambian con el tema.
    effect(() => {
      const el = this.canvasUso();
      const u = this.uso();
      this.tema.efectivo();
      if (el && u) this.dibujar(el.nativeElement, u);
    });
  }

  ngOnDestroy(): void {
    for (const t of this.temporizadores) clearInterval(t);
    this.grafica?.destroy();
  }

  refrescar(): void {
    this.cargarSalud();
    this.cargarPanorama();
  }

  private cargarSalud(): void {
    this.monitor.salud().subscribe({
      next: (s) => { this.salud.set(s); this.error.set(''); },
      error: () => this.error.set('No fue posible consultar el estado de la plataforma.'),
    });
    this.monitor.infraestructura().subscribe({ next: (i) => this.infra.set(i), error: () => {} });
  }

  private cargarPanorama(): void {
    // Cada bloque falla por su cuenta: que no se pueda leer la bitácora no
    // debe dejar en blanco el estado de la infraestructura.
    this.monitor.cartera().subscribe({ next: (c) => this.cartera.set(c), error: () => {} });
    this.monitor.uso().subscribe({ next: (u) => this.uso.set(u), error: () => {} });
    this.monitor.adopcion().subscribe({ next: (a) => this.adopcion.set(a), error: () => {} });
    this.monitor.bitacora(40).subscribe({ next: (b) => this.bitacora.set(b), error: () => {} });
    this.actualizado.set(new Date());
  }

  // --- Lectura de las medidas ----------------------------------------------

  /** Estrecha el tipo en la plantilla: Angular no puede hacerlo con uniones discriminadas. */
  valor<T>(m: Medida<T> | undefined | null): T | null {
    return m?.disponible ? m.valor : null;
  }

  motivo<T>(m: Medida<T> | undefined | null): string | null {
    return m && !m.disponible ? m.motivo : null;
  }

  // --- Semáforos ------------------------------------------------------------

  /**
   * Umbrales de consumo. 75 % avisa y 90 % exige: por encima de ahí, en un
   * contenedor, lo siguiente suele ser que el proceso muera sin avisar.
   */
  semaforoConsumo(pct: number | undefined): Semaforo {
    if (pct === undefined) return 'neutro';
    if (pct >= 90) return 'critico';
    if (pct >= 75) return 'aviso';
    return 'ok';
  }

  readonly semaforoBase = computed<Semaforo>(() => {
    const b = this.salud()?.base;
    if (!b) return 'neutro';
    if (!b.disponible) return 'critico';
    // Una base que responde pero tarda es la primera señal de saturación.
    return b.valor.latenciaMs > 500 ? 'aviso' : 'ok';
  });

  readonly semaforoConexiones = computed<Semaforo>(() => {
    const c = this.valor(this.salud()?.base)?.conexiones;
    const v = this.valor(c);
    if (!v || !v.maximo) return 'neutro';
    return this.semaforoConsumo(Math.round((v.enUso / v.maximo) * 100));
  });

  /** Cuántas alertas de cada tipo hay en la cartera. */
  readonly conteoAlertas = computed(() => {
    const a = this.cartera()?.alertas ?? [];
    return {
      vencida: a.filter((x) => x.tipo === 'vencida').length,
      suspendida: a.filter((x) => x.tipo === 'suspendida').length,
      por_vencer: a.filter((x) => x.tipo === 'por_vencer').length,
      dormida: a.filter((x) => x.tipo === 'dormida').length,
    };
  });

  etiquetaAlerta(tipo: string): string {
    return {
      vencida: 'Vencida',
      suspendida: 'Suspendida',
      por_vencer: 'Por vencer',
      dormida: 'Sin actividad',
    }[tipo] ?? tipo;
  }

  /** Entradas de `porSuscripcion`/`porPlan` en algo que la plantilla pueda recorrer. */
  pares(r: Record<string, number> | undefined): Array<{ clave: string; valor: number }> {
    return Object.entries(r ?? {}).map(([clave, valor]) => ({ clave, valor }));
  }

  // --- Formato --------------------------------------------------------------

  bytes(n: number | undefined): string {
    if (n === undefined || n === null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  }

  duracion(segundos: number | undefined): string {
    if (!segundos) return '—';
    const d = Math.floor(segundos / 86400);
    const h = Math.floor((segundos % 86400) / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min`;
  }

  /** Qué mide de verdad el número: dentro de un contenedor, el sistema describe otra máquina. */
  fuente(f: string | undefined): string {
    return {
      'cgroup-v2': 'límite del contenedor',
      'cgroup-v1': 'límite del contenedor',
      sistema: 'sistema operativo',
    }[f ?? ''] ?? '';
  }

  hora(iso: string | Date | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // --- Gráfica de volumen ---------------------------------------------------

  private readonly canvasUso = viewChild<ElementRef<HTMLCanvasElement>>('canvasUso');
  private grafica?: Chart;

  private variable(nombre: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  }

  private dibujar(canvas: HTMLCanvasElement, u: Uso): void {
    const color = this.variable('--serie-teal');
    const ink = this.variable('--ink-soft');
    const grid = this.variable('--border');

    const data: ChartConfiguration<'line'>['data'] = {
      labels: u.serie.map((p) => p.dia.slice(5)),
      datasets: [{
        label: 'Casos en la plataforma',
        data: u.serie.map((p) => p.casos),
        borderColor: color,
        backgroundColor: color + '26',
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      }],
    };

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { titleColor: '#fff', bodyColor: '#fff' } },
        scales: {
          x: { ticks: { color: ink, maxTicksLimit: 10 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: ink, precision: 0 }, grid: { color: grid } },
        },
      },
    };

    if (this.grafica) {
      this.grafica.data = data;
      this.grafica.options = config.options!;
      this.grafica.update();
    } else {
      this.grafica = new Chart(canvas, config);
    }
  }
}
