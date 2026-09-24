import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EstadoLlamada, Llamada } from '../../core/models';

/**
 * La modal que abre el doble clic sobre "Atendidas"/"Perdidas" del reporte
 * de llamadas: la lista real de llamadas detrás de ese número. Hermana de
 * `DetalleReporteModalComponent`, pero para llamadas en vez de casos — la
 * forma de los datos no calza (número/agente/atendida-en, no
 * ciudadano/canal/prioridad), así que es su propio componente en vez de
 * forzar uno genérico.
 */
@Component({
  selector: 'app-detalle-llamadas',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dl-overlay" (click)="cerrarClick()">
      <div class="dl-card" role="dialog" aria-modal="true" [attr.aria-label]="titulo()" (click)="$event.stopPropagation()">
        <header class="dl-head">
          <h2>{{ titulo() }}</h2>
          <button type="button" class="dl-x" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </header>

        @if (cargando()) {
          <p class="dl-msg">Cargando…</p>
        } @else if (error()) {
          <p class="dl-msg dl-error">{{ error() }}</p>
        } @else if (llamadas().length === 0) {
          <p class="dl-msg">Sin llamadas que coincidan con este valor.</p>
        } @else {
          <p class="dl-cuenta">{{ llamadas().length }} llamada{{ llamadas().length === 1 ? '' : 's' }} de los últimos 30 días.</p>
          <div class="dl-tabla-wrap">
            <table class="dl-tabla">
              <thead>
                <tr>
                  <th>Número</th><th>Estado</th><th>Agente</th>
                  <th>Recibida</th><th>Atendida</th><th>Caso</th>
                </tr>
              </thead>
              <tbody>
                @for (l of llamadas(); track l.id) {
                  <tr>
                    <td class="mono">{{ l.numero }}</td>
                    <td><span class="badge" [attr.data-estado]="l.estado">{{ estadoLabel(l.estado) }}</span></td>
                    <td>{{ l.agentePbx || l.atendidaPor || '—' }}</td>
                    <td class="mono">{{ l.creadoEn | date:'short' }}</td>
                    <td class="mono">{{ l.atendidaEn ? (l.atendidaEn | date:'short') : '—' }}</td>
                    <td>
                      @if (l.casoId) {
                        <a [routerLink]="['/caso', l.casoId]" (click)="cerrar.emit()">Abrir caso →</a>
                      } @else {
                        <span class="dl-sin-caso">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './detalle-llamadas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetalleLlamadasModalComponent {
  readonly titulo = input.required<string>();
  readonly cargando = input(false);
  readonly error = input('');
  readonly llamadas = input<Llamada[]>([]);
  readonly cerrar = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cerrar.emit();
  }

  cerrarClick(): void {
    this.cerrar.emit();
  }

  estadoLabel(e: EstadoLlamada): string {
    return { sonando: 'Timbrando', atendida: 'Atendida', perdida: 'Perdida', finalizada: 'Finalizada' }[e] ?? e;
  }
}
