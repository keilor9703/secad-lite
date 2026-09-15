import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DetalleComponent } from '../detalle/detalle';
import { CasosService } from '../../core/casos.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { NotificacionesService } from '../../core/notificaciones.service';
import { CasosWsService } from '../../core/casos-ws.service';
import { Agencia, CanalAtencion, Caso, EstadoCaso } from '../../core/models';
import { ToastService } from '../../shared/toast/toast.service';
import { SelectorComponent } from '../../shared/selector/selector';
import { OpcionComponent } from '../../shared/selector/opcion';

/** Un paso del ciclo de vida y los casos que están en él. */
interface Grupo {
  estado: EstadoCaso;
  titulo: string;
  pista: string;
  casos: Caso[];
}

/** Los pasos del ciclo, en el orden en que avanza un caso. */
const PASOS: ReadonlyArray<[EstadoCaso, string, string]> = [
  ['nuevo', 'Sin tomar', 'Llegaron a su canal y nadie los ha tomado'],
  ['en_gestion', 'En gestión', 'Los atiende alguien, sin recursos en camino'],
  ['despachado', 'Con recursos', 'Hay una unidad asignada o en el sitio'],
  ['derivado', 'Remitidos', 'Se enviaron a otra entidad'],
];

/**
 * Consola del despachador: los casos que llegan a SUS canales en una sola cola
 * priorizada, de la más urgente a la menos.
 *
 * Se descartó el tablero de columnas: en operación real la carga se concentra
 * en uno o dos estados, así que tres cuartas partes del ancho quedaban vacías
 * mientras los casos que sí importan se apretaban en una columna angosta. Aquí
 * el estado es un encabezado (y un filtro), no una columna, y cada caso ocupa
 * una fila completa — se escanea de arriba abajo, que es como se lee una cola.
 */
@Component({
  selector: 'app-despacho',
  standalone: true,
  imports: [RouterLink, DetalleComponent, FormsModule, SelectorComponent, OpcionComponent],
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
  readonly agenciasTodas = signal<Agencia[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  /** Se recalcula cada minuto para que la antigüedad no quede congelada. */
  private readonly ahora = signal(Date.now());

  readonly veTodo = computed(() => this.auth.tienePermiso('casos.ver_todos'));
  /** Administrador o superadmin: puede mirar la bandeja de CUALQUIER agencia/canal, no solo la suya. */
  readonly puedeElegirAgenciaCanal = computed(() => this.auth.esAdmin() || this.auth.esSuperadmin());

  /** Agencia de quien mira (no aplica al superadmin, que no pertenece a ninguna). */
  readonly miAgenciaNombre = computed(() => {
    const id = this.auth.sesion()?.agencia;
    return this.agenciasTodas().find((a) => a.id === id)?.nombre ?? null;
  });

  // --- Qué bandeja se está mirando -----------------------------------------
  //
  // Regla del sistema: se ve UN canal a la vez, nunca varios mezclados, y no
  // existe «todas las agencias». No es una simplificación de la interfaz: un
  // caso que policía ya tomó y bomberos todavía no tiene DOS estados a la vez,
  // así que una vista combinada tendría que mentir sobre uno de los dos. El
  // poder del supervisor o del administrador no es ver todo junto, es poder
  // CAMBIAR de bandeja.
  //
  // Quien tiene un canal configurado entra directo al suyo y no elige nada.

  readonly agenciaSel = signal<string | null>(null);
  readonly canalSel = signal<string | null>(null);

  /** El canal propio del funcionario, si el administrador le configuró uno. */
  readonly miCanalId = computed<string | null>(() => this.auth.sesion()?.canales?.[0] ?? null);

  /** La bandeja que se está mirando ahora mismo. Sin ella no hay tablero. */
  readonly canalActivo = computed<string | null>(() => this.miCanalId() ?? this.canalSel());

  readonly canalActivoNombre = computed(() => {
    const c = this.canales().find((x) => x.id === this.canalActivo());
    if (!c) return null;
    return {
      canal: `${c.codigo} · ${c.nombre}`,
      agencia: this.agenciasTodas().find((a) => a.id === c.agenciaId)?.nombre ?? '',
    };
  });

  /**
   * Agencias entre las que puede moverse quien mira. Administrador y
   * superadmin, todas; un supervisor, solo la suya — el selector le sirve para
   * cambiar de canal dentro de su entidad, no para mirar otras.
   */
  readonly agenciasElegibles = computed(() => {
    if (this.puedeElegirAgenciaCanal()) return this.agenciasTodas();
    const mia = this.auth.sesion()?.agencia;
    return this.agenciasTodas().filter((a) => a.id === mia);
  });

  readonly canalesDeAgenciaSel = computed(() => {
    const ag = this.agenciaSel();
    return ag ? this.canales().filter((c) => c.agenciaId === ag) : [];
  });

  /** Solo quien NO tiene canal propio elige; los demás entran directo a su bandeja. */
  readonly debeElegirBandeja = computed(() => !this.miCanalId());

  cambiarAgencia(agenciaId: string | null): void {
    this.agenciaSel.set(agenciaId);
    // Al cambiar de entidad, el canal anterior deja de tener sentido.
    this.canalSel.set(null);
    this.casos.set([]);
  }

  cambiarCanal(canalId: string | null): void {
    this.canalSel.set(canalId);
    this.cargar();
  }

  /** El tablero pinta la bandeja del canal activo, tal como viene del servidor. */
  readonly casosFiltrados = computed(() => this.casos());

  /** La cola repartida por paso del ciclo, los más urgentes arriba de cada uno. */
  readonly columnas = computed<Grupo[]>(() => {
    const abiertos = this.casosFiltrados().filter((c) => c.estado !== 'cerrado');
    return PASOS.map(([estado, titulo, pista]) => ({
      estado, titulo, pista,
      casos: abiertos.filter((c) => c.estado === estado).sort((a, b) => this.urgencia(b) - this.urgencia(a)),
    }));
  });

  /**
   * Paso al que se acotó la cola, si el despachador tocó uno de los contadores.
   * Sin filtro se ven todos los pasos, cada uno bajo su encabezado.
   */
  readonly filtroEstado = signal<EstadoCaso | null>(null);

  alternarEstado(estado: EstadoCaso): void {
    this.filtroEstado.update((v) => (v === estado ? null : estado));
  }

  tituloEstado(estado: EstadoCaso): string {
    return PASOS.find(([e]) => e === estado)?.[1] ?? estado;
  }

  /** Lo que se pinta: los pasos con casos, acotados al filtro si hay uno. */
  readonly gruposVisibles = computed(() => {
    const f = this.filtroEstado();
    return this.columnas().filter((g) => g.casos.length && (!f || g.estado === f));
  });

  /** Caso abierto en el panel de gestión, a la derecha de la cola. */
  readonly seleccionado = signal<string | null>(null);

  /**
   * Casos que este despachador ya abrió alguna vez. Se guarda en el puesto de
   * trabajo: sirve para señalar lo que aún no ha mirado, que es la pregunta que
   * se hace todo el tiempo — "¿qué me llegó y todavía no he visto?".
   */
  private readonly vistos = signal<Set<string>>(this.leerVistos());

  /** El último caso que entró a ESTA bandeja, para no perderlo de vista. */
  readonly ultimo = computed<Caso | null>(() => {
    const abiertos = this.casosFiltrados().filter((c) => c.estado !== 'cerrado');
    if (!abiertos.length) return null;
    // Por llegada a la bandeja, igual que el reloj de las filas: lo último que
    // entró aquí, no lo último que ocurrió en el municipio.
    const cuando = (c: Caso) => new Date(c.enColaDesde ?? c.creadoEn).getTime();
    return abiertos.reduce((a, b) => (cuando(a) > cuando(b) ? a : b));
  });

  /** Los que llevan más de 5 minutos en la cola sin que nadie los abra. */
  readonly sinAbrir = computed(() =>
    this.casosFiltrados().filter((c) => c.estado !== 'cerrado' && !this.vistos().has(c.id) && this.minutos(c) >= 5),
  );

  noVisto(c: Caso): boolean {
    return !this.vistos().has(c.id);
  }

  readonly total = computed(() => this.columnas().reduce((n, c) => n + c.casos.length, 0));

  constructor() {
    // Si la dirección trae un caso, se abre en el panel al entrar.
    // Acepta ambas formas: el enlace antiguo /despacho/:id y ?caso=.
    this.seleccionado.set(this.ruta.snapshot.paramMap.get('id') ?? this.ruta.snapshot.queryParamMap.get('caso'));
    // Cambiar de instancia deja sin sentido la bandeja elegida: se limpia todo
    // y se vuelve a empezar.
    //
    // El cuerpo va dentro de `untracked` a propósito. `cargar()` lee
    // `canalActivo()` —y con él `canalSel`—, así que sin aislarlo el efecto
    // quedaba dependiendo de la misma señal que borra dos líneas más arriba:
    // al elegir un canal, el efecto se volvía a disparar y dejaba el selector
    // otra vez en blanco. La única dependencia que debe tener es el tenant.
    effect(() => {
      this.auth.tenantActivo();
      untracked(() => {
        this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
        this.catalogos.agencias().subscribe({ next: (a) => this.agenciasTodas.set(a), error: () => {} });
        this.agenciaSel.set(null);
        this.canalSel.set(null);
        this.filtroEstado.set(null);
        this.casos.set([]);
        this.cargar();
      });
    });
    this.casosWs.conectar();
    this.casosWs.eventos.subscribe(({ tipo, caso }) => this.aplicarEnVivo(tipo, caso));
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
    const canal = this.canalActivo();
    // Sin bandeja elegida no hay nada que pedir: la pantalla invita a elegirla.
    if (!canal) { this.casos.set([]); this.cargando.set(false); return; }
    if (!silencioso) this.cargando.set(true);
    // El tablero solo trabaja casos abiertos de ESTE canal, y cada caso vuelve
    // con el estado de esta bandeja, no con el macro-estado del caso.
    this.casosSvc.listar({ abiertos: true, limite: 500, canalId: canal }).subscribe({
      next: (cs) => { this.anunciarNuevos(cs); this.casos.set(cs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la cola.'); this.cargando.set(false); },
    });
  }

  /**
   * Un caso que cambió en vivo, traído al tablero de ESTA bandeja.
   *
   * El servidor emite a todo el secad porque el socket tiene una sola sala por
   * inquilino, así que cada pantalla filtra lo suyo: se descarta lo que no toca
   * a este canal, y el estado que se pinta es el de este canal —no el del caso,
   * que puede ir muy por delante si otra entidad ya despachó—. Un caso que se
   * cierra para esta bandeja sale de ella aunque el caso siga abierto para las
   * demás; eso es justamente lo que se buscaba.
   */
  private aplicarEnVivo(tipo: 'nuevo' | 'actualizado', caso: Caso): void {
    const canal = this.canalActivo();
    if (!canal) return;

    const mio = caso.canalesEstado?.find((e) => e.canalId === canal);
    // Sin estados por canal (caso sin bandejas) se usa el del propio caso.
    const estado = mio?.estado ?? (caso.canalesEstado ? null : caso.estado);
    if (estado === null) {
      // Llegó a otros canales, no al mío: no me incumbe.
      this.casos.update((cs) => cs.filter((c) => c.id !== caso.id));
      return;
    }

    const enBandeja = { ...caso, estado } as Caso;
    if (estado === 'cerrado') {
      this.casos.update((cs) => cs.filter((c) => c.id !== caso.id));
      return;
    }
    this.casos.update((cs) => {
      const existe = cs.some((c) => c.id === caso.id);
      if (existe) return cs.map((c) => (c.id === caso.id ? enBandeja : c));
      return tipo === 'nuevo' ? [enBandeja, ...cs] : cs;
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

  /**
   * Minutos que este caso lleva en ESTA bandeja.
   *
   * No es lo mismo que el tiempo desde que ocurrió el hecho: un caso remitido a
   * bomberos tres horas después empieza a contar para ellos cuando les llega, y
   * medirles el tiempo desde la llamada original los haría aparecer siempre en
   * rojo por un retraso que no fue suyo. `enColaDesde` lo trae el servidor con
   * la vista por canal; sin él (Consulta, casos sin bandeja) se usa la
   * recepción del caso.
   */
  minutos(c: Caso): number {
    const desde = new Date(c.enColaDesde ?? c.creadoEn).getTime();
    return Math.max(0, Math.floor((this.ahora() - desde) / 60000));
  }

  espera(c: Caso): string {
    const m = this.minutos(c);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d`;
  }

  /**
   * La misma espera, abreviada: en la cola vive en una columna de ancho fijo,
   * así que necesita caber siempre igual para que los tiempos se comparen de un
   * vistazo, uno debajo del otro.
   */
  esperaCorta(c: Caso): string {
    const m = this.minutos(c);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
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
