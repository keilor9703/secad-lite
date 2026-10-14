import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';

import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { AdminService } from '../../core/admin.service';
import { PbxService } from '../../core/pbx.service';
import { BalizaService } from '../../core/baliza.service';
import { Tenant } from '../../core/models';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ToastService } from '../../shared/toast/toast.service';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { IconoComponent, NombreIcono } from '../../shared/icono/icono';
import { LogoComponent } from '../../shared/logo/logo';
import { ToastComponent } from '../../shared/toast/toast';
import { ConfirmComponent } from '../../shared/confirm/confirm';
import { SelectorComponent } from '../../shared/selector/selector';
import { OpcionComponent } from '../../shared/selector/opcion';
import { SoporteComponent } from '../../shared/soporte/soporte';

/** Una pestaña de la barra. Se describen como datos para poder MEDIRLAS. */
export interface ModuloNav {
  ruta: string;
  /** Clave de `--mod-*`: el color con el que se escanea la barra. */
  mod: string;
  icono: NombreIcono;
  etiqueta: string;
}

/**
 * Reparte los módulos entre la barra y el menú «Más».
 *
 * Va aparte de la clase, y es pura, porque la regla tiene un caso que no se ve
 * a simple vista y conviene poder probarlo solo: si el módulo en el que el
 * usuario está parado no alcanzaba a entrar, entra igual desplazando al
 * último. La pestaña de la página que se está mirando no puede estar escondida
 * dentro de un menú — sin eso, entrar a Monitor desde el menú dejaba la barra
 * sin ninguna pestaña marcada como activa.
 *
 * @param caben   cuántos caben, medido; `Infinity` mientras no se haya medido.
 * @param activo  índice del módulo actual en `modulos`, o -1 si no hay ninguno.
 */
export function repartirModulos(modulos: ModuloNav[], caben: number, activo: number): ModuloNav[] {
  if (caben >= modulos.length) return modulos;
  const enBarra = modulos.slice(0, Math.max(0, caben));
  if (activo >= 0 && activo >= caben && enBarra.length) enBarra[enBarra.length - 1] = modulos[activo];
  return enBarra;
}

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [ReactiveFormsModule, RouterOutlet, RouterLink, RouterLinkActive, TemaToggleComponent, LogoComponent, IconoComponent, ToastComponent, ConfirmComponent, SelectorComponent, OpcionComponent, SoporteComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent implements OnInit, AfterViewInit, OnDestroy {
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private pbx = inject(PbxService);
  /**
   * Pública a propósito: la plantilla la consulta directamente. Es el único
   * sitio del sistema donde se pinta la baliza, así que no vale la pena
   * duplicar sus señales como propiedades del armazón.
   */
  readonly baliza = inject(BalizaService);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly sesion = this.auth.sesion;
  readonly esAdmin = this.auth.esAdmin;
  // Cada módulo se muestra solo si el rol tiene el permiso que lo gobierna.
  // ¡Ojo! No usar 'casos.ver' aquí: lo comparten Recepción, Consulta y
  // Catálogos (todos lo necesitan para leer su propia bandeja/catálogo), así
  // que un rol con solo Recepción vería también la pestaña Despacho. El
  // permiso propio y exclusivo del módulo Despacho es 'despacho.ver'.
  readonly puedeVerDespacho = computed(() => this.auth.tienePermiso('despacho.ver'));
  readonly puedeRecepcionar = computed(() => this.auth.tienePermiso('casos.crear'));
  /** La consulta histórica es de quien supervisa; el resto trabaja en su cola. */
  readonly puedeConsultar = computed(() => this.auth.tienePermiso('casos.ver_todos'));
  readonly puedeVerLlamadas = computed(() => this.auth.tienePermiso('pbx.usar'));
  readonly puedeVerRecursos = computed(() => this.auth.tienePermiso('recursos.ver'));
  readonly puedeVerPanel = computed(() => this.auth.tienePermiso('metricas.ver'));
  readonly puedeVerCatalogos = computed(() => this.auth.tienePermiso('catalogos.gestionar'));
  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly tenantCtx = this.auth.tenantCtx;
  /** Instancias disponibles para el selector del superadmin. */
  readonly tenants = signal<Tenant[]>([]);
  /** Nº de llamadas timbrando (indicador global de la planta telefónica). */
  readonly sonando = this.pbx.sonando;

  /**
   * Los módulos operativos trabajan siempre dentro de un tenant: el funcionario
   * usa el suyo y el superadmin, el que tenga en gestión. Sin tenant no hay nada
   * que mostrar, así que se ocultan hasta que elija uno.
   */
  readonly operativoVisible = computed(() => !this.esSuperadmin() || !!this.tenantCtx());

  /**
   * Bandera/logo del tenant activo, chica y sutil junto a su indicador en la
   * barra superior. Para un usuario normal viene en su propia sesión; el
   * superadmin no tiene un tenant fijo, así que se resuelve con la lista de
   * instancias que esta misma barra ya carga para el selector.
   */
  readonly logoTenant = computed(() => {
    if (this.esSuperadmin()) {
      return this.tenants().find((t) => t.codigo === this.tenantCtx())?.logoDataUrl ?? null;
    }
    return this.sesion()?.logoDataUrl ?? null;
  });

  /** Nav desplegable en pantallas angostas (ver shell.scss, ≤900px). */
  readonly menuAbierto = signal(false);

  // --- Las pestañas, como datos --------------------------------------------
  //
  // Antes iban escritas a mano en la plantilla, cada una detrás de su `@if` de
  // permiso. Se pasan a datos por una razón concreta: para repartirlas entre
  // la barra y el menú «Más» hay que SABER CUÁNTAS son y cuánto mide cada una,
  // y eso no se puede hacer sobre marcado suelto.

  /** Los módulos que este rol puede ver, en el orden en que van en la barra. */
  readonly modulos = computed<ModuloNav[]>(() => {
    if (this.sesion()?.tipo !== 'institucional') return [];
    const m: ModuloNav[] = [];
    if (this.operativoVisible()) {
      if (this.puedeRecepcionar()) m.push({ ruta: '/recepcion', mod: 'recepcion', icono: 'recepcion', etiqueta: 'Recepción' });
      if (this.puedeVerDespacho()) m.push({ ruta: '/despacho', mod: 'despacho', icono: 'despacho', etiqueta: 'Despacho' });
      if (this.puedeConsultar()) m.push({ ruta: '/casos', mod: 'consulta', icono: 'consulta', etiqueta: 'Consulta' });
      if (this.puedeVerRecursos()) m.push({ ruta: '/recursos', mod: 'recursos', icono: 'recursos', etiqueta: 'Recursos' });
      // Mapa y Panel son las dos vistas de análisis (metricas.ver): van juntas.
      if (this.puedeVerPanel()) {
        m.push({ ruta: '/dashboard', mod: 'panel', icono: 'panel', etiqueta: 'Panel' });
        m.push({ ruta: '/mapa', mod: 'mapa', icono: 'mapa', etiqueta: 'Mapa' });
      }
    }
    if (this.puedeVerCatalogos()) m.push({ ruta: '/catalogos', mod: 'catalogos', icono: 'catalogos', etiqueta: 'Catálogos' });
    if (this.esAdmin()) m.push({ ruta: '/admin', mod: 'admin', icono: 'admin', etiqueta: 'Administración' });
    // Solo el dueño de la plataforma: instancias, suscripciones y módulos.
    if (this.esSuperadmin()) {
      m.push({ ruta: '/plataforma', mod: 'plataforma', icono: 'plataforma', etiqueta: 'Plataforma' });
      m.push({ ruta: '/monitor', mod: 'monitor', icono: 'monitor', etiqueta: 'Monitor' });
    }
    return m;
  });

  // --- Reparto entre la barra y el menú «Más» -------------------------------
  //
  // El problema que resuelve esto: con diez pestañas la barra necesita unos
  // 1110px y a 1366px —el portátil institucional corriente— dispone de 572px.
  // Lo que había era `overflow-x: auto` con la barra de desplazamiento oculta,
  // así que los cinco módulos que no cabían quedaban RECORTADOS SIN AVISO: sin
  // barra visible, sin degradado, sin flecha. Y el gesto que los alcanzaba era
  // la rueda horizontal —un trackpad—; con el ratón de un escritorio, que solo
  // tiene rueda vertical, no se llegaba a ellos de ninguna forma.
  //
  // Ahora se mide cuántas caben y el resto pasa a un menú. Se MIDE y no se
  // calcula por puntos de corte porque el ancho real depende del rol (cuántos
  // módulos), del idioma (cuánto mide cada nombre) y de si el superadmin tiene
  // el selector de instancia. Un punto de corte acierta para un caso y falla
  // para los demás.

  private readonly navRef = viewChild<ElementRef<HTMLElement>>('navBarra');
  /** Cuántos módulos caben en la barra. `Infinity` = todos (aún sin medir, o menú vertical). */
  private readonly caben = signal(Number.POSITIVE_INFINITY);
  readonly menuMasAbierto = signal(false);
  /** La ruta actual, para no esconder NUNCA el módulo en el que se está parado. */
  private readonly rutaActual = signal('/');

  /** Índice del módulo activo, o -1. */
  private readonly indiceActivo = computed(() => {
    const url = this.rutaActual();
    return this.modulos().findIndex((m) => url === m.ruta || url.startsWith(m.ruta + '/'));
  });

  /**
   * Los que se ven en la barra. Si el módulo activo no alcanzaba a entrar, se
   * mete a la fuerza desplazando al último: la pestaña de la página en la que
   * uno está no puede estar escondida en un menú.
   */
  readonly enBarra = computed<ModuloNav[]>(() =>
    repartirModulos(this.modulos(), this.caben(), this.indiceActivo()));

  /** Los que quedaron fuera y viven en el menú «Más», en su orden original. */
  readonly enMenu = computed<ModuloNav[]>(() => {
    const barra = new Set(this.enBarra().map((m) => m.ruta));
    return this.modulos().filter((m) => !barra.has(m.ruta));
  });

  /** Para el `title` del botón «Más»: qué hay dentro, sin tener que abrirlo. */
  readonly etiquetasEnMenu = computed(() => this.enMenu().map((m) => m.etiqueta).join(', '));

  private readonly botonMas = viewChild<ElementRef<HTMLElement>>('botonMas');
  /**
   * Dónde empieza el panel del menú «Más», en píxeles desde el borde de la
   * barra.
   *
   * Hace falta calcularlo porque el panel NO puede colgar del botón: `.nav` es
   * `overflow: hidden` —así ninguna pestaña asoma a medias— y eso se comía el
   * desplegable entero. El panel vive al nivel de la barra, que es `sticky` y
   * le sirve de bloque contenedor, y se alinea con el botón a mano.
   */
  readonly izquierdaMenuMas = signal(0);

  alternarMenuMas(): void {
    if (this.menuMasAbierto()) { this.menuMasAbierto.set(false); return; }
    const boton = this.botonMas()?.nativeElement;
    const barra = boton?.closest('.topbar') as HTMLElement | null;
    if (boton && barra) {
      const b = boton.getBoundingClientRect();
      const t = barra.getBoundingClientRect();
      // Alineado al botón, pero sin salirse por la derecha de la pantalla.
      const ANCHO = 190;
      const MARGEN = 12;
      this.izquierdaMenuMas.set(Math.min(b.left - t.left, t.width - ANCHO - MARGEN));
    }
    this.menuMasAbierto.set(true);
  }

  private observador?: ResizeObserver;

  constructor() {
    // Cierra el menú desplegable al navegar (clic en un enlace, atrás/adelante
    // del navegador, o un cambio de tenant que redirige) — si no, quedaba
    // abierto tapando la página de destino en móvil.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.menuAbierto.set(false);
        this.menuMasAbierto.set(false);
        this.rutaActual.set(this.router.url);
      });
    this.rutaActual.set(this.router.url);
    // Cambiar de rol o de instancia cambia la lista de módulos, y entonces el
    // reparto anterior ya no vale. `effect` lo vuelve a medir después de que
    // Angular pinte la lista nueva.
    effect(() => {
      this.modulos();
      queueMicrotask(() => this.medir());
    });
  }

  ngAfterViewInit(): void {
    // Se observa la BARRA, no la ventana: también se angosta cuando aparece el
    // selector de instancia o cuando el nombre del usuario es largo, y eso un
    // `window.resize` no lo ve.
    const nav = this.navRef()?.nativeElement;
    document.addEventListener('keydown', this.alPulsarTecla);
    if (!nav || typeof ResizeObserver === 'undefined') { this.medir(); return; }
    this.observador = new ResizeObserver(() => this.medir());
    this.observador.observe(nav);
    this.medir();
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
    document.removeEventListener('keydown', this.alPulsarTecla);
  }

  /** Escape cierra el menú «Más», igual que cualquier otro desplegable. */
  private readonly alPulsarTecla = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.menuMasAbierto()) this.menuMasAbierto.set(false);
  };

  /**
   * Cuántas pestañas caben de verdad.
   *
   * Mide los anchos NATURALES: para eso quita por un instante la clase que
   * esconde las que hoy no caben, lee, y la repone. Como leer `offsetWidth`
   * fuerza el cálculo de estilo de forma síncrona y todo ocurre dentro de la
   * misma tarea, el navegador nunca llega a pintar el estado intermedio — no
   * hay parpadeo.
   */
  private medir(): void {
    const nav = this.navRef()?.nativeElement;
    if (!nav) return;
    // Menú vertical (≤900px, ver shell.scss): ahí caben todas y sobra ancho.
    if (nav.classList.contains('vertical') || window.innerWidth <= 900) {
      this.caben.set(Number.POSITIVE_INFINITY);
      return;
    }
    const items = Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-modulo]'));
    if (!items.length) return;

    const escondidos = items.filter((e) => e.classList.contains('fuera'));
    escondidos.forEach((e) => e.classList.remove('fuera'));
    const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
    const anchos = items.map((e) => e.getBoundingClientRect().width);
    // El indicador de llamadas timbrando NO entra en el reparto: no se esconde
    // nunca (es justo el que no puede pasar inadvertido), así que su ancho se
    // descuenta del espacio disponible.
    const llamadas = nav.querySelector<HTMLElement>('.nav-llamadas');
    const anchoLlamadas = llamadas ? llamadas.getBoundingClientRect().width + gap : 0;
    escondidos.forEach((e) => e.classList.add('fuera'));

    const disponible = nav.clientWidth - anchoLlamadas;
    // Primera pasada sin reservar nada: si caben todas, no hace falta botón.
    let usado = 0;
    let n = 0;
    for (const a of anchos) {
      const siguiente = usado + (n ? gap : 0) + a;
      if (siguiente > disponible) break;
      usado = siguiente;
      n++;
    }
    if (n === anchos.length) { this.caben.set(Number.POSITIVE_INFINITY); return; }

    // Si sobra alguna, aparece el botón «Más» y hay que reservarle su sitio.
    // Su ancho es fijo por CSS (--ancho-mas) justamente para que reservarlo no
    // dependa de medir un elemento que todavía no está pintado.
    const reserva = parseFloat(getComputedStyle(nav).getPropertyValue('--ancho-mas')) || 40;
    const tope = disponible - reserva - gap;
    usado = 0; n = 0;
    for (const a of anchos) {
      const siguiente = usado + (n ? gap : 0) + a;
      if (siguiente > tope) break;
      usado = siguiente;
      n++;
    }
    this.caben.set(n);
  }

  ngOnInit(): void {
    // Los permisos del token pueden estar desactualizados: se piden los vigentes.
    this.auth.refrescarPerfil();
    const s = this.sesion();
    if (s?.tipo !== 'institucional') return;
    // La baliza escucha desde cualquier pantalla, no solo desde Despacho: ese
    // era justamente el problema — el aviso solo existía dentro del módulo.
    this.baliza.iniciar();
    if (!this.esSuperadmin()) {
      // Sin pbx.usar, o sin que el tenant haya contratado la planta, no se
      // consulta: pbx.usar es transversal (lo puede tener el rol aunque el
      // municipio no haya comprado PBX) — sin la segunda condición, cada
      // carga de la aplicación topaba con un 403 y su aviso.
      if (this.puedeVerLlamadas() && this.auth.tieneIntegracion('pbx')) this.pbx.conectar();
      return;
    }
    this.admin.listarTenants().subscribe({
      next: (ts) => {
        this.tenants.set(ts);
        // Arranca sobre la primera instancia para no dejar la sesión sin contexto.
        if (!this.tenantCtx() && ts.length) this.cambiarTenant(ts[0].codigo, false);
        else if (this.tenantCtx() && this.tieneIntegracionTenant(ts, this.tenantCtx(), 'pbx')) this.pbx.conectar();
      },
      error: () => {},
    });
  }

  /** ¿El tenant (de la lista ya cargada) tiene esta integración? Para el superadmin, que no tiene una propia. */
  private tieneIntegracionTenant(tenants: Tenant[], codigo: string, clave: string): boolean {
    const integraciones = tenants.find((t) => t.codigo === codigo)?.integraciones;
    // Sin lista configurada (null) no hay restricción — igual criterio que en el backend.
    if (!integraciones) return true;
    return integraciones.includes(clave);
  }

  /** Cambia el tenant en gestión: reabre la cola en vivo y recarga la vista. */
  cambiarTenant(codigo: string, recargarVista = true): void {
    if (!codigo || codigo === this.tenantCtx()) return;
    this.auth.setTenantCtx(codigo);
    this.baliza.limpiar();
    this.pbx.desconectar();
    this.pbx.llamadas.set([]);
    this.pbx.ultimaEntrante.set(null);
    if (this.tieneIntegracionTenant(this.tenants(), codigo, 'pbx')) this.pbx.conectar();
    if (!recargarVista) return;
    // Cada página se recarga sola al cambiar el tenant activo; solo el detalle
    // de un caso queda huérfano (su id es de la otra instancia), así que desde
    // ahí se vuelve a la bandeja.
    if (/^\/recepcion\/.+/.test(this.router.url)) this.router.navigateByUrl('/recepcion');
  }

  /**
   * Diálogo de reporte a la mesa de ayuda. Se monta solo cuando se abre: así
   * el contexto técnico se recoge en el momento del problema, no al cargar la
   * aplicación, y el informe no envejece dentro de una pestaña abierta todo el
   * turno.
   */
  readonly soporteAbierto = signal(false);

  // --- Cambiar MI contraseña (autoservicio) --------------------------------
  readonly cambioClaveAbierto = signal(false);
  readonly claveForm = new FormGroup({
    claveActual: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    claveNueva: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    claveConfirma: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  readonly guardandoClave = signal(false);

  abrirCambioClave(): void {
    this.claveForm.reset({ claveActual: '', claveNueva: '', claveConfirma: '' });
    this.cambioClaveAbierto.set(true);
  }

  guardarClave(): void {
    const { claveActual, claveNueva, claveConfirma } = this.claveForm.getRawValue();
    if (!claveActual || !claveNueva) {
      this.toast.advertencia('Diligencie la contraseña actual y la nueva.');
      return;
    }
    if (claveNueva !== claveConfirma) {
      this.toast.advertencia('La confirmación no coincide con la contraseña nueva.');
      return;
    }
    this.guardandoClave.set(true);
    this.auth.cambiarContrasena(claveActual, claveNueva).subscribe({
      next: () => {
        this.guardandoClave.set(false);
        this.cambioClaveAbierto.set(false);
        this.toast.exito('Contraseña actualizada.');
      },
      // El toast global ya anuncia el motivo (actual incorrecta, muy corta…).
      error: () => this.guardandoClave.set(false),
    });
  }

  salir(): void {
    this.pbx.desconectar();
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  /** Inicial del nombre, para el avatar cuando la instancia no tiene logo propio. */
  readonly inicial = computed(() => (this.sesion()?.nombre ?? '?').trim().charAt(0).toUpperCase());
}
