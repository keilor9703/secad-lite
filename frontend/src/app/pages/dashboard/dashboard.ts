import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MetricasService, Resumen } from '../../core/metricas.service';

interface Barra { etiqueta: string; valor: number; clave: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardComponent implements OnInit {
  private metricas = inject(MetricasService);

  readonly resumen = signal<Resumen | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  private readonly estadoLabels: Record<string, string> = {
    nuevo: 'Nuevo', en_gestion: 'En gestión', derivado: 'Derivado', cerrado: 'Cerrado',
  };
  private readonly canalLabels: Record<string, string> = {
    llamada: 'Llamada', chat: 'Chat', integracion: 'Integración',
  };

  readonly porEstado = computed<Barra[]>(() => this.aBarras(this.resumen()?.porEstado, this.estadoLabels));
  readonly porCanal = computed<Barra[]>(() => this.aBarras(this.resumen()?.porCanal, this.canalLabels));
  readonly maxAgencia = computed(() => Math.max(1, ...(this.resumen()?.porAgencia ?? []).map((a) => a.total)));

  ngOnInit(): void {
    this.metricas.resumen().subscribe({
      next: (r) => { this.resumen.set(r); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar las métricas.'); this.cargando.set(false); },
    });
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
}
