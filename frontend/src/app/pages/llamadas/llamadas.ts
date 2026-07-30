import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PbxService } from '../../core/pbx.service';
import { EstadoLlamada, Llamada } from '../../core/models';

/**
 * Cola de la planta telefónica en vivo. Las llamadas entrantes (timbrando) se
 * resaltan; "Atender" crea/enlaza el caso y salta a su detalle (screen-pop).
 */
@Component({
  selector: 'app-llamadas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './llamadas.html',
  styleUrl: './llamadas.scss',
})
export class LlamadasComponent implements OnInit, OnDestroy {
  private pbx = inject(PbxService);
  private router = inject(Router);

  readonly sonando = this.pbx.sonando;
  readonly recientes = computed(() =>
    this.pbx.llamadas().filter((l) => l.estado !== 'sonando').slice(0, 30),
  );
  readonly atendiendo = signal<string | null>(null);
  readonly error = signal('');

  ngOnInit(): void {
    this.pbx.conectar();
  }

  ngOnDestroy(): void {
    // Se mantiene la conexión viva a nivel de servicio (indicador global del shell).
  }

  atender(l: Llamada): void {
    this.atendiendo.set(l.id);
    this.error.set('');
    this.pbx.atender(l.id).subscribe({
      next: ({ casoId }) => { this.atendiendo.set(null); this.router.navigate(['/recepcion', casoId]); },
      error: (e) => { this.atendiendo.set(null); this.error.set(e?.error?.message ?? 'No fue posible atender la llamada.'); },
    });
  }

  abrirCaso(l: Llamada): void {
    if (l.casoId) this.router.navigate(['/recepcion', l.casoId]);
  }

  estadoLabel(e: EstadoLlamada): string {
    return { sonando: 'Timbrando', atendida: 'Atendida', perdida: 'Perdida', finalizada: 'Finalizada' }[e];
  }
}
