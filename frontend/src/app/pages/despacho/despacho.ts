import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { CanalAtencion, Caso, EstadoCaso } from '../../core/models';

/** Una columna del tablero: un estado del ciclo de vida y sus casos. */
interface Columna {
  estado: EstadoCaso;
  titulo: string;
  pista: string;
  casos: Caso[];
}

/**
 * Consola del despachador: los casos que llegan a SUS canales, ordenados por lo
 * que hay que hacer con ellos. Cada columna es un paso del ciclo de vida, así
 * que el tablero se lee de izquierda a derecha y lo pendiente salta a la vista.
 */
@Component({
  selector: 'app-despacho',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './despacho.html',
  styleUrl: './despacho.scss',
})
export class DespachoComponent {
  private casosSvc = inject(CasosService);
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);

  readonly casos = signal<Caso[]>([]);
  readonly canales = signal<CanalAtencion[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  /** Se recalcula cada minuto para que la antigüedad no quede congelada. */
  private readonly ahora = signal(Date.now());

  readonly veTodo = computed(() => this.auth.tienePermiso('casos.ver_todos'));

  /** Canales que atiende quien mira, resueltos a su nombre. */
  readonly misCanales = computed(() => {
    const ids = this.auth.sesion()?.canales ?? [];
    return this.canales().filter((c) => ids.includes(c.id));
  });

  /** El tablero: un paso por columna, los más urgentes arriba. */
  readonly columnas = computed<Columna[]>(() => {
    const abiertos = this.casos().filter((c) => c.estado !== 'cerrado');
    const def: Array<[EstadoCaso, string, string]> = [
      ['nuevo', 'Sin tomar', 'Llegaron a su canal y nadie los ha tomado'],
      ['en_gestion', 'En gestión', 'Los está atendiendo alguien, sin recursos en camino'],
      ['despachado', 'Con recursos', 'Hay una unidad asignada o en el sitio'],
      ['derivado', 'Remitidos', 'Se enviaron a otra entidad'],
    ];
    return def.map(([estado, titulo, pista]) => ({
      estado, titulo, pista,
      casos: abiertos.filter((c) => c.estado === estado).sort((a, b) => this.urgencia(b) - this.urgencia(a)),
    }));
  });

  readonly sinTomar = computed(() => this.columnas()[0]?.casos.length ?? 0);
  readonly total = computed(() => this.columnas().reduce((n, c) => n + c.casos.length, 0));

  constructor() {
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
      this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
    });
    // La cola cambia sola: se refresca sin que el despachador tenga que recargar.
    setInterval(() => { this.ahora.set(Date.now()); if (!document.hidden) this.cargar(true); }, 30_000);
  }

  cargar(silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    this.casosSvc.listar().subscribe({
      next: (cs) => { this.casos.set(cs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la cola.'); this.cargando.set(false); },
    });
  }

  /** Minutos desde que entró el caso. */
  minutos(c: Caso): number {
    return Math.max(0, Math.floor((this.ahora() - new Date(c.creadoEn).getTime()) / 60000));
  }

  espera(c: Caso): string {
    const m = this.minutos(c);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d`;
  }

  /**
   * Semáforo de atención: combina prioridad y espera. Un caso de prioridad alta
   * envejece más rápido, que es como se prioriza en una sala de despacho.
   */
  semaforo(c: Caso): 'ok' | 'atencion' | 'critico' {
    const umbral = c.prioridad === 'alta' ? 5 : c.prioridad === 'media' ? 15 : 30;
    const m = this.minutos(c);
    if (m >= umbral * 3) return 'critico';
    if (m >= umbral) return 'atencion';
    return 'ok';
  }

  private urgencia(c: Caso): number {
    const peso = { alta: 3, media: 2, baja: 1 }[c.prioridad ?? 'media'];
    return peso * 1000 + this.minutos(c);
  }

  canalesDe(c: Caso): string {
    const ids = c.canales ?? [];
    const cods = this.canales().filter((x) => ids.includes(x.id)).map((x) => x.codigo);
    return cods.join(', ');
  }

  canalIcon(c: Caso): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c.canal] ?? '•';
  }
}
