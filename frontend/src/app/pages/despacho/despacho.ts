import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';

import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DetalleComponent } from '../detalle/detalle';
import { CasosService } from '../../core/casos.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { NotificacionesService } from '../../core/notificaciones.service';
import { CasosWsService } from '../../core/casos-ws.service';
import { CanalAtencion, Caso, EstadoCaso } from '../../core/models';
import { ToastService } from '../../shared/toast/toast.service';

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
  imports: [RouterLink, DetalleComponent],
  templateUrl: './despacho.html',
  styleUrl: './despacho.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DespachoComponent {
  private casosSvc = inject(CasosService);
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private notif = inject(NotificacionesService);
  private casosWs = inject(CasosWsService);

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

  /** Caso abierto en el panel de gestión, a la derecha de la cola. */
  readonly seleccionado = signal<string | null>(null);

  /**
   * Casos que este despachador ya abrió alguna vez. Se guarda en el puesto de
   * trabajo: sirve para señalar lo que aún no ha mirado, que es la pregunta que
   * se hace todo el tiempo — "¿qué me llegó y todavía no he visto?".
   */
  private readonly vistos = signal<Set<string>>(this.leerVistos());

  /** El último caso que entró a su cola, para no perderlo de vista. */
  readonly ultimo = computed<Caso | null>(() => {
    const abiertos = this.casos().filter((c) => c.estado !== 'cerrado');
    if (!abiertos.length) return null;
    return abiertos.reduce((a, b) => (new Date(a.creadoEn) > new Date(b.creadoEn) ? a : b));
  });

  /** Los que llevan más de 5 minutos en la cola sin que nadie los abra. */
  readonly sinAbrir = computed(() =>
    this.casos().filter((c) => c.estado !== 'cerrado' && !this.vistos().has(c.id) && this.minutos(c) >= 5),
  );

  noVisto(c: Caso): boolean {
    return !this.vistos().has(c.id);
  }

    readonly sinTomar = computed(() => this.columnas()[0]?.casos.length ?? 0);
  readonly total = computed(() => this.columnas().reduce((n, c) => n + c.casos.length, 0));

  constructor() {
    // Si la dirección trae un caso, se abre en el panel al entrar.
    // Acepta ambas formas: el enlace antiguo /despacho/:id y ?caso=.
    this.seleccionado.set(this.ruta.snapshot.paramMap.get('id') ?? this.ruta.snapshot.queryParamMap.get('caso'));
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
      this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
    });
    this.casosWs.conectar();
    this.casosWs.eventos.subscribe(({ tipo, caso }) => {
      if (tipo === 'nuevo') {
        this.casos.update(cs => {
          const existe = cs.some(c => c.id === caso.id);
          return existe ? cs.map(c => c.id === caso.id ? caso : c) : [caso, ...cs];
        });
      } else {
        this.casos.update(cs => cs.map(c => c.id === caso.id ? caso : c));
      }
    });
    // La cola cambia sola: se refresca sin que el despachador tenga que recargar.
    setInterval(() => { this.ahora.set(Date.now()); if (!document.hidden) this.cargar(true); }, 60_000);
  }

  /**
   * Abre el caso en el panel de gestión, sin salir del módulo.
   *
   * El caso viaja como parámetro de consulta y no como segmento de ruta a
   * propósito: cambiar el segmento haría que Angular recreara este componente,
   * y la cola volvería a cargarse desde cero justo cuando el caso está pasando
   * a gestión — se perdería el cambio de columna.
   */
  abrir(c: Caso): void {
    this.seleccionado.set(c.id);
    this.marcarVisto(c.id);
    this.router.navigate([], { relativeTo: this.ruta, queryParams: { caso: c.id }, replaceUrl: true });
  }

  cerrarPanel(): void {
    this.seleccionado.set(null);
    this.router.navigate([], { relativeTo: this.ruta, queryParams: {} });
  }

  private marcarVisto(id: string): void {
    const s = new Set(this.vistos());
    s.add(id);
    this.vistos.set(s);
    try { localStorage.setItem(this.claveVistos(), JSON.stringify([...s].slice(-500))); } catch { /* sin almacenamiento */ }
  }

  private claveVistos(): string {
    return `falconcad_vistos_${this.auth.sesion()?.usuario ?? 'anon'}`;
  }

  private leerVistos(): Set<string> {
    try {
      const v = localStorage.getItem(this.claveVistos());
      return new Set<string>(v ? JSON.parse(v) : []);
    } catch {
      return new Set<string>();
    }
  }

  cargar(silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    // El tablero solo trabaja casos abiertos: se piden así al servidor.
    this.casosSvc.listar({ abiertos: true, limite: 500 }).subscribe({
      next: (cs) => { this.anunciarNuevos(cs); this.casos.set(cs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la cola.'); this.cargando.set(false); },
    });
  }

  // --- Aviso activo: el caso nuevo se anuncia, no hay que descubrirlo -------

  /** Ids ya vistos por ESTA sesión del tablero, para detectar los recién llegados. */
  private idsConocidos: Set<string> | null = null;
  /** Timbre encendido/apagado; la sala decide y la elección se recuerda en el puesto. */
  readonly sonidoActivo = signal(localStorage.getItem('falconcad_despacho_sonido') !== 'off');

  alternarSonido(): void {
    this.sonidoActivo.update((v) => !v);
    try { localStorage.setItem('falconcad_despacho_sonido', this.sonidoActivo() ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
  }

  /**
   * Compara la tanda del refresco (cada 30 s) con la anterior: cada caso que
   * no estaba se anuncia con un toast y, si el timbre está activo, con un tono
   * corto — el despachador ya no tiene que barrer la columna "Sin tomar" con
   * la mirada para saber si llegó algo. La primera carga no anuncia nada.
   */
  private anunciarNuevos(cs: Caso[]): void {
    if (this.idsConocidos === null) {
      this.idsConocidos = new Set(cs.map((c) => c.id));
      return;
    }
    const nuevos = cs.filter((c) => !this.idsConocidos!.has(c.id));
    for (const c of cs) this.idsConocidos.add(c.id);
    if (!nuevos.length) return;
    const primero = nuevos[0];
    this.toast.info(nuevos.length === 1
      ? `Caso nuevo en la cola: ${primero.titulo}`
      : `${nuevos.length} casos nuevos en la cola.`);
    
    if (nuevos.length === 1) {
      this.notif.notificar('Caso nuevo en la cola', primero.titulo);
    } else {
      this.notif.notificar('Casos nuevos en la cola', `${nuevos.length} casos esperan atención`);
    }

    if (this.sonidoActivo()) this.timbre();
  }

  /**
   * Dos tonos cortos por WebAudio: no depende de ningún archivo de sonido.
   *
   * Un AudioContext nace SUSPENDIDO si la pestaña no tuvo ninguna interacción
   * del usuario todavía (política de autoplay del navegador): sin resume(),
   * el timbre "suena" en el código pero no se oye — explica que el aviso
   * pareciera funcionar unas veces sí y otras no.
   */
  private timbre(): void {
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const tono = (inicio: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + inicio + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + inicio);
        osc.stop(ctx.currentTime + inicio + 0.3);
      };
      tono(0, 880);
      tono(0.32, 1174);
      setTimeout(() => ctx.close(), 900);
    } catch { /* sin audio disponible */ }
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

  canalIconData(c: Caso): { emoji: string; label: string } {
    const map: Record<string, { emoji: string; label: string }> = {
      llamada: { emoji: '📞', label: 'Llamada telefónica' },
      chat: { emoji: '💬', label: 'Chat en línea' },
      whatsapp: { emoji: '🟢', label: 'WhatsApp' },
      integracion: { emoji: '🔌', label: 'Integración externa' },
    };
    return map[c.canal] ?? { emoji: '•', label: c.canal };
  }
}
