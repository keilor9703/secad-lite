import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { AuthService } from '../../core/auth.service';
import { MetricasService, Resumen, ResumenLlamadas } from '../../core/metricas.service';

interface Barra { etiqueta: string; valor: number; clave: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private metricas = inject(MetricasService);
  private auth = inject(AuthService);

  readonly resumen = signal<Resumen | null>(null);
  readonly llamadas = signal<ResumenLlamadas | null>(null);
  readonly cargando = signal(true);
  readonly error = signal('');

  private readonly estadoLabels: Record<string, string> = {
    nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado',
  };
  private readonly canalLabels: Record<string, string> = {
    llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración',
  };
  private readonly estadoLlamadaLabels: Record<string, string> = {
    sonando: 'Timbrando', atendida: 'Atendidas', perdida: 'Perdidas', finalizada: 'Finalizadas',
  };

  readonly porEstado = computed<Barra[]>(() => this.aBarras(this.resumen()?.porEstado, this.estadoLabels));
  readonly porCanal = computed<Barra[]>(() => this.aBarras(this.resumen()?.porCanal, this.canalLabels));
  readonly maxAgencia = computed(() => Math.max(1, ...(this.resumen()?.porAgencia ?? []).map((a) => a.total)));
  /** Tiempos de respuesta (últimos 30 días): la medida real del centro. */
  readonly tiempos = computed(() => this.resumen()?.tiempos ?? null);
  readonly porEstadoLlamada = computed<Barra[]>(() => this.aBarras(this.llamadas()?.porEstado, this.estadoLlamadaLabels));

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

  constructor() {
    // Las métricas son del tenant activo (ver RecepcionComponent).
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
    });
  }

  private cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.metricas.resumen().subscribe({
      next: (r) => { this.resumen.set(r); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar las métricas.'); this.cargando.set(false); },
    });
    // Aparte: si la planta telefónica no está en uso, este reporte igual
    // carga (con conteos en cero) sin bloquear el resto del panel.
    this.metricas.llamadas().subscribe({
      next: (r) => this.llamadas.set(r),
      error: () => {},
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
