import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CasosService } from '../../core/casos.service';
import { MetricasService, Resumen } from '../../core/metricas.service';
import { Caso } from '../../core/models';

/**
 * Wallboard: la pantalla grande de la sala 123. No se opera — se MIRA desde
 * lejos: colas por paso, semáforos de espera, lo último que llegó y los
 * tiempos del mes. Tipografía enorme, refresco solo (15 s) y reloj vivo.
 */
@Component({
  selector: 'app-wallboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './wallboard.html',
  styleUrl: './wallboard.scss',
})
export class WallboardComponent implements OnInit, OnDestroy {
  private casosSvc = inject(CasosService);
  private metricas = inject(MetricasService);

  readonly casos = signal<Caso[]>([]);
  readonly resumen = signal<Resumen | null>(null);
  readonly ahora = signal(new Date());

  private refresco?: ReturnType<typeof setInterval>;
  private reloj?: ReturnType<typeof setInterval>;

  readonly sinTomar = computed(() => this.casos().filter((c) => c.estado === 'nuevo'));
  readonly enGestion = computed(() => this.casos().filter((c) => c.estado === 'en_gestion'));
  readonly conRecursos = computed(() => this.casos().filter((c) => c.estado === 'despachado'));
  readonly remitidos = computed(() => this.casos().filter((c) => c.estado === 'derivado'));

  /** Casos en rojo: llevan esperando más de lo que su prioridad tolera. */
  readonly criticos = computed(() =>
    this.casos().filter((c) => c.estado === 'nuevo' && this.semaforo(c) === 'critico'),
  );

  /** Los últimos en llegar, para que la sala vea entrar el trabajo. */
  readonly ultimos = computed(() =>
    [...this.casos()]
      .sort((a, b) => new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime())
      .slice(0, 6),
  );

  readonly tiempos = computed(() => this.resumen()?.tiempos?.global ?? null);

  ngOnInit(): void {
    this.cargar();
    this.refresco = setInterval(() => { if (!document.hidden) this.cargar(); }, 15_000);
    this.reloj = setInterval(() => this.ahora.set(new Date()), 1000);
  }

  ngOnDestroy(): void {
    if (this.refresco) clearInterval(this.refresco);
    if (this.reloj) clearInterval(this.reloj);
  }

  private cargar(): void {
    this.casosSvc.listar({ abiertos: true, limite: 500 }).subscribe({ next: (cs) => this.casos.set(cs), error: () => {} });
    this.metricas.resumen().subscribe({ next: (r) => this.resumen.set(r), error: () => {} });
  }

  minutos(c: Caso): number {
    return Math.max(0, Math.floor((this.ahora().getTime() - new Date(c.creadoEn).getTime()) / 60000));
  }

  espera(c: Caso): string {
    const m = this.minutos(c);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  /** El mismo semáforo del tablero de despacho: prioridad alta envejece más rápido. */
  semaforo(c: Caso): 'ok' | 'atencion' | 'critico' {
    const umbral = c.prioridad === 'alta' ? 5 : c.prioridad === 'media' ? 15 : 30;
    const m = this.minutos(c);
    if (m >= umbral * 3) return 'critico';
    if (m >= umbral) return 'atencion';
    return 'ok';
  }

  duracion(min: number | null): string {
    if (min === null) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${Math.round(min % 60)} min`;
  }
}
