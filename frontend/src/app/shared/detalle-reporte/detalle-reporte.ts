import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Caso, Canal, EstadoCaso, PrioridadCaso } from '../../core/models';

/**
 * La modal que abre el doble clic sobre una barra de un reporte (Panel o
 * Mapa): la lista real de casos detrás de ese número, cada uno con su ID
 * corto y sus datos clave. La fila completa es un enlace al caso — ahí sí
 * está "toda la información", no hace falta repetirla aquí.
 *
 * Deliberadamente "tonta" (sin lógica propia de carga): quien la usa ya le
 * pasa los casos, cargando o el error — así sirve igual para Panel y Mapa,
 * cada uno con su propia forma de pedir el detalle al backend.
 */
@Component({
  selector: 'app-detalle-reporte',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dr-overlay" (click)="cerrarClick()">
      <div class="dr-card" role="dialog" aria-modal="true" [attr.aria-label]="titulo()" (click)="$event.stopPropagation()">
        <header class="dr-head">
          <h2>{{ titulo() }}</h2>
          <button type="button" class="dr-x" (click)="cerrar.emit()" aria-label="Cerrar">✕</button>
        </header>

        @if (cargando()) {
          <p class="dr-msg">Cargando…</p>
        } @else if (error()) {
          <p class="dr-msg dr-error">{{ error() }}</p>
        } @else if (casos().length === 0) {
          <p class="dr-msg">Sin casos que coincidan con este valor.</p>
        } @else {
          <p class="dr-cuenta">{{ casos().length }} caso{{ casos().length === 1 ? '' : 's' }} — clic en una fila para abrir el caso completo.</p>
          <div class="dr-tabla-wrap">
            <table class="dr-tabla">
              <thead>
                <tr>
                  <th>Id</th><th>Código</th><th>Título</th><th>Ciudadano</th><th>Agencia</th>
                  <th>Canal</th><th>Estado</th><th>Prioridad</th><th>Recepción</th>
                </tr>
              </thead>
              <tbody>
                @for (c of casos(); track c.id) {
                  <tr [routerLink]="['/caso', c.id]" (click)="cerrar.emit()">
                    <td class="mono" [title]="c.id">{{ c.id.slice(0, 8) }}</td>
                    <td class="mono">{{ c.codigoCaso || '—' }}</td>
                    <td class="dr-titulo">{{ c.titulo }}</td>
                    <td>{{ c.ciudadano }}</td>
                    <td>{{ c.agencia }}</td>
                    <td>{{ canalLabel(c.canal) }}</td>
                    <td><span class="badge" [attr.data-estado]="c.estado">{{ estadoLabel(c.estado) }}</span></td>
                    <td><span class="badge-prio" [attr.data-prio]="c.prioridad"><span class="badge-prio-punto"></span>{{ prioridadLabel(c.prioridad) }}</span></td>
                    <td class="mono">{{ c.creadoEn | date:'short' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './detalle-reporte.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetalleReporteModalComponent {
  readonly titulo = input.required<string>();
  readonly cargando = input(false);
  readonly error = input('');
  readonly casos = input<Caso[]>([]);
  readonly cerrar = output<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cerrar.emit();
  }

  cerrarClick(): void {
    this.cerrar.emit();
  }

  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración' }[c] ?? c;
  }
  estadoLabel(e: EstadoCaso | string): string {
    return ({ nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' } as Record<string, string>)[e] ?? e;
  }
  prioridadLabel(p: PrioridadCaso | undefined): string {
    return { alta: 'Alta', media: 'Media', baja: 'Baja' }[p ?? 'media'];
  }
}
