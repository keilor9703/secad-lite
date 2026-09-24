import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { PbxService } from '../../core/pbx.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { AdminService } from '../../core/admin.service';
import { GeografiaService, Municipio } from '../../core/geografia.service';
import { GoogleMapsLoaderService } from '../../core/google-maps-loader.service';
import { ToastService } from '../../shared/toast/toast.service';
import { AutocompletarComponent, OpcionAutocompletar } from '../../shared/autocompletar/autocompletar';
import { SelectorComponent } from '../../shared/selector/selector';
import { OpcionComponent } from '../../shared/selector/opcion';
import { DictadoComponent } from '../../shared/dictado/dictado';
import {
  Agencia, Canal, CanalAtencion, Caso, CodigoCaso, CrearCaso, EstadoCaso, Llamada, PrioridadCaso,
} from '../../core/models';

@Component({
  selector: 'app-recepcion',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, AutocompletarComponent, SelectorComponent, OpcionComponent, DictadoComponent],
  templateUrl: './recepcion.html',
  styleUrl: './recepcion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecepcionComponent implements OnInit {
  private casosSvc = inject(CasosService);
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private geografia = inject(GeografiaService);
  private googleMaps = inject(GoogleMapsLoaderService);
  private pbx = inject(PbxService);
  private toast = inject(ToastService);

  readonly casos = signal<Caso[]>([]);
  /**
   * Vista de la bandeja. Quien atiende canales arranca viendo su cola; quien no
   * tiene ninguno asignado (recepción central, supervisión) ve todo el secad.
   */
  /**
   * Alcance de la bandeja. Lo decide el servidor: sin casos.ver_todos solo
   * llegan los casos de los canales propios. Aquí solo se anuncia, para que el
   * funcionario sepa por qué ve lo que ve.
   */
  readonly veTodo = computed(() => this.auth.tienePermiso('casos.ver_todos'));
  readonly puedeRecepcionar = computed(() => this.auth.tienePermiso('casos.crear'));

  /** Llamadas timbrando: de aquí arranca el trabajo de quien recepciona. */
  readonly sonando = this.pbx.sonando;
  readonly sonidoActivo = this.pbx.sonidoActivo;
  alternarSonido(): void { this.pbx.alternarSonido(); }

  /**
   * Lo que este operador acaba de tomar. Es la confirmación de su trabajo: la
   * bandeja completa vive en Casos y la cola de atención, en Despacho.
   */
  readonly misRecientes = computed(() => {
    const yo = this.auth.sesion()?.usuario;
    return this.casos().filter((c) => c.creadoPor === yo).slice(0, 6);
  });

  /**
   * Llamada que se está trabajando en el formulario ahora mismo: se enlaza
   * al caso cuando se guarda (ver `crear`), y se suelta si el operador
   * cancela sin guardar (ver `limpiarForm`).
   */
  private readonly llamadaEnCurso = signal<Llamada | null>(null);

  esLaLlamadaEnCurso(l: Llamada): boolean {
    return this.llamadaEnCurso()?.id === l.id;
  }

  /**
   * Toma la llamada: desaparece de la cola de los demás operadores (nadie
   * más puede tomarla) y trae el número al formulario, para completar el
   * caso mientras el operador sigue al teléfono con el ciudadano. No crea
   * ningún caso ni saca al operador de Recepción — eso solo pasa al hacer
   * clic en "Guardar caso", que es cuando de verdad hay algo que radicar.
   */
  tomarLlamada(l: Llamada): void {
    this.error.set('');
    this.pbx.reclamar(l.id).subscribe({
      next: (llamada) => {
        this.form.controls.telefono.setValue(llamada.numero);
        this.llamadaEnCurso.set(llamada);
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible tomar la llamada.'),
    });
  }
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly guardando = signal(false);

  readonly canales: Canal[] = ['llamada', 'chat', 'whatsapp', 'integracion'];
  readonly prioridades: PrioridadCaso[] = ['alta', 'media', 'baja'];

  // Catálogos del secad
  readonly agencias = signal<Agencia[]>([]);
  readonly canalesAtencion = signal<CanalAtencion[]>([]);
  readonly codigos = signal<CodigoCaso[]>([]);

  readonly total = computed(() => this.casos().length);
  readonly nuevos = computed(() => this.casos().filter((c) => c.estado === 'nuevo').length);
  readonly enGestion = computed(() => this.casos().filter((c) => c.estado === 'en_gestion').length);

  /** Nombre del funcionario que recepciona, para el encabezado del formulario. */
  readonly sesionUsuario = computed(() => this.auth.sesion()?.nombre ?? '');
  /** Su username: para distinguir en la cola una llamada dirigida a otro. */
  readonly miUsuario = computed(() => this.auth.sesion()?.usuario ?? '');

  /** Entidad de origen: la del funcionario, fija y no editable. */
  readonly agenciaOrigen = computed(() => {
    const id = this.auth.sesion()?.agencia;
    return this.agencias().find((a) => a.id === id) ?? null;
  });

  /**
   * Las entidades con sus canales, para marcarlos de varias a la vez. Un mismo
   * hecho suele necesitar más de una: un accidente con heridos es tránsito,
   * salud y policía, y todas deben verlo en su cola al mismo tiempo.
   */
  readonly destinos = computed(() => {
    const canales = this.canalesAtencion().filter((c) => c.activo);
    return this.agencias()
      .map((a) => ({ agencia: a, canales: canales.filter((c) => c.agenciaId === a.id) }))
      .filter((g) => g.canales.length);
  });

  /** Canales de destino marcados, para recalcular resumen y principal. */
  readonly canalesMarcados = signal<string[]>([]);

  /** Entidades con al menos un canal marcado. */
  readonly agenciasMarcadas = computed(() => {
    const ids = new Set(this.canalesMarcados());
    const canales = this.canalesAtencion();
    const conMarca = new Set(canales.filter((c) => ids.has(c.id)).map((c) => c.agenciaId));
    return this.agencias().filter((a) => conMarca.has(a.id));
  });

  /** Frase de confirmación: «Policía Nacional (C1, C2) y Salud (A1)». */
  readonly resumenDestino = computed(() => {
    const ids = new Set(this.canalesMarcados());
    const partes = this.destinos()
      .map((g) => {
        const codigos = g.canales.filter((c) => ids.has(c.id)).map((c) => c.codigo);
        return codigos.length ? `${g.agencia.nombre} (${codigos.join(', ')})` : '';
      })
      .filter(Boolean);
    if (!partes.length) return '';
    if (partes.length === 1) return partes[0];
    return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  });

  /** Siempre abierto: recepcionar es el trabajo de esta pantalla, no una opción. */
  mostrarForm = true;
  readonly form = new FormGroup({
    canal: new FormControl<Canal>('llamada', { nonNullable: true }),
    ciudadano: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    telefono: new FormControl('', { nonNullable: true }),
    direccionLlamante: new FormControl('', { nonNullable: true }),
    codigoCaso: new FormControl('', { nonNullable: true }),
    titulo: new FormControl('', { nonNullable: true }),
    prioridad: new FormControl<PrioridadCaso>('media', { nonNullable: true }),
    descripcion: new FormControl('', { nonNullable: true }),
    ciudad: new FormControl('', { nonNullable: true }),
    barrio: new FormControl('', { nonNullable: true }),
    /**
     * Dirección completa — la llena el buscador de Google al elegir una
     * sugerencia (queda en su forma estandarizada, la de Google), pero sigue
     * editable: el operador puede afinarla (apto, referencia) a mano.
     */
    direccion: new FormControl('', { nonNullable: true }),
    /** Municipio del caso (código DANE) — por defecto el del tenant; el operador puede elegir otro de la lista. */
    municipioCodigo: new FormControl('', { nonNullable: true }),
    lat: new FormControl<number | null>(null),
    lng: new FormControl<number | null>(null),
    agenciaResponsableId: new FormControl<string | null>(null),
  });

  /** Municipios del departamento del tenant, para el select de municipio del caso. */
  readonly municipiosTenant = signal<Municipio[]>([]);

  /** Hora de apertura del formulario, como referencia visible del registro. */
  readonly abiertoEn = signal(new Date());
  readonly buscandoDireccion = signal(false);

  /**
   * Si el buscador de Google (Places) quedó montado. `false` mientras carga o
   * si el backend no tiene la clave configurada — en ese caso el formulario
   * cae a un campo de dirección manual, con el mismo botón "Buscar en el
   * mapa" resolviendo contra OpenStreetMap, como antes.
   */
  readonly googleDisponible = signal(false);
  private gmpElement?: google.maps.places.PlaceAutocompleteElement;
  private geocoder?: google.maps.Geocoder;

  private mapa?: import('leaflet').Map;
  private marcador?: import('leaflet').Marker;

  constructor() {
    // La bandeja y los catálogos son del tenant activo: si el superadmin cambia
    // de instancia, se recargan solos con los datos de la nueva.
    effect(() => {
      this.auth.tenantActivo();
      this.cargarCatalogos();
      this.cargar();
      this.cargarMunicipioPorDefecto();
    });
    // El asistente de tipificación reacciona a lo que se va escribiendo en el relato.
    this.form.controls.descripcion.valueChanges.subscribe((v) => this.relato.set(v));

    // Municipio del caso: al elegir uno de la lista, se refleja también en el
    // campo "ciudad" que es el que de verdad queda guardado en el caso — la
    // geocodificación por clic en el mapa lo sigue pudiendo sobrescribir. Y se
    // reacota el buscador de Google al municipio nuevo: sin esto, cambiar de
    // municipio dejaba las sugerencias apuntando todavía al anterior.
    this.form.controls.municipioCodigo.valueChanges.subscribe((codigo) => {
      const m = this.municipiosTenant().find((x) => x.codigoDane === codigo);
      if (m) this.form.controls.ciudad.setValue(m.nombre);
      this.biasBuscador();
    });
  }

  /**
   * Municipios del departamento del tenant y, dentro de esos, el propio
   * tenant preseleccionado — el operador puede cambiarlo si el caso es de un
   * municipio vecino, pero lo normal (la inmensa mayoría de los casos) es el
   * suyo propio.
   *
   * `sesion().municipioCodigo` es del tenant DEL TOKEN — para el superadmin
   * eso es siempre null (él no pertenece a ninguno fijo), así que sin este
   * caso aparte la lista quedaba vacía en todo tenant que gestionara. Se
   * resuelve entonces como en otras vistas: de la lista de tenants que ya
   * tiene cargada, buscando el que tiene en gestión.
   */
  private cargarMunicipioPorDefecto(): void {
    if (this.auth.esSuperadmin()) {
      const tenant = this.auth.tenantActivo();
      if (!tenant) { this.municipiosTenant.set([]); return; }
      this.admin.listarTenants().subscribe({
        next: (ts) => this.cargarMunicipiosDelCodigo(ts.find((t) => t.codigo === tenant)?.codigoDane ?? ''),
        error: () => this.municipiosTenant.set([]),
      });
      return;
    }
    this.cargarMunicipiosDelCodigo(this.auth.sesion()?.municipioCodigo ?? '');
  }

  private cargarMunicipiosDelCodigo(codigoTenant: string): void {
    if (!codigoTenant) { this.municipiosTenant.set([]); return; }
    this.geografia.municipios(codigoTenant.slice(0, 2)).subscribe((m) => {
      this.municipiosTenant.set(m);
      this.form.controls.municipioCodigo.setValue(codigoTenant);
    });
  }

  /**
   * Nombre del municipio elegido en el formulario, o vacío si no hay ninguno.
   */
  private municipioActual(): string {
    const codigo = this.form.controls.municipioCodigo.value;
    return this.municipiosTenant().find((m) => m.codigoDane === codigo)?.nombre ?? '';
  }

  /**
   * Pega el municipio elegido al final de una dirección. Solo hace falta en
   * el modo de respaldo (sin clave de Google): Nominatim, sin el municipio,
   * suele resolver a una calle homónima de otro municipio en vez de la del
   * caso. El buscador de Google no lo necesita — ya devuelve la dirección
   * completa con ciudad incluida.
   */
  private conMunicipio(base: string): string {
    if (!base) return base;
    const municipio = this.municipioActual();
    return municipio ? `${base}, ${municipio}` : base;
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.casosSvc.listar().subscribe({
      next: (data) => { this.casos.set(data); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la bandeja.'); this.cargando.set(false); },
    });
  }

  private cargarCatalogos(): void {
    this.catalogos.agencias(true).subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    this.catalogos.canales(undefined, true).subscribe({ next: (c) => this.canalesAtencion.set(c), error: () => {} });
    this.catalogos.codigos(true).subscribe({ next: (c) => this.codigos.set(c), error: () => {} });
  }

  // --- Formulario -------------------------------------------------------------

  ngOnInit(): void {
    // El mapa y el buscador de direcciones se preparan una vez pintado el
    // formulario, que ya está a la vista.
    setTimeout(() => this.prepararMapa(), 0);
    setTimeout(() => this.prepararBuscadorDireccion(), 0);
  }

  /**
   * Descarta lo escrito y deja el formulario listo para la siguiente
   * llamada. Si había una llamada tomada que no llegó a convertirse en
   * caso (se limpió a mano en vez de guardar), se suelta: vuelve a la cola
   * compartida en lugar de quedar atascada para siempre en este puesto.
   */
  limpiarForm(): void {
    const enCurso = this.llamadaEnCurso();
    if (enCurso) {
      this.pbx.soltar(enCurso.id).subscribe({ error: () => {} });
      this.llamadaEnCurso.set(null);
    }
    this.form.reset(this.formVacio());
    this.canalesMarcados.set([]);
    this.sugeridaPorCodigo.set(null);
    this.abiertoEn.set(new Date());
    this.error.set('');
    // El buscador guarda su propio texto (no es un <input> del formulario):
    // sin esto, quedaba mostrando la última dirección buscada.
    if (this.gmpElement) this.gmpElement.value = '';
  }

  /** Catálogo de códigos para el buscador con lista propia: código como etiqueta, descripción como detalle. */
  readonly opcionesCodigo = computed<OpcionAutocompletar[]>(() =>
    this.codigos()
      .filter((c) => c.activo !== false)
      .map((c) => ({ valor: c.codigo, etiqueta: c.codigo, detalle: c.descripcion })),
  );

  /**
   * Al elegir el código de caso se traen su descripción, su prioridad y la
   * agencia que suele atenderlo — igual que en el CAD completo, donde la
   * tipificación arrastra el resto del formulario.
   */
  aplicarCodigo(): void {
    const codigo = this.form.controls.codigoCaso.value.trim().toUpperCase();
    const def = this.codigos().find((c) => c.codigo.toUpperCase() === codigo);
    if (!def) return;
    this.form.controls.titulo.setValue(def.descripcion);
    this.form.controls.prioridad.setValue(def.prioridad);
    // La tipificación sugiere quién suele atenderlo —se destaca en la lista—,
    // pero no marca canales por su cuenta: a quién se envía lo decide el
    // operador, que oye la llamada. Es una pista aparte de quién termine
    // encabezando el caso, que puede ser otra si el operador marca distinto.
    this.sugeridaPorCodigo.set(def.agenciaSugeridaId ?? null);
  }

  /** Agencia que el código de caso sugiere, para destacarla en la lista. */
  private readonly sugeridaPorCodigo = signal<string | null>(null);

  // --- Asistente de tipificación --------------------------------------------

  /** Espejo del relato que escribe el operador, para reaccionar mientras teclea. */
  private readonly relato = signal('');

  /**
   * Sugerencias de código de caso a partir del relato: puntúa cada código del
   * catálogo por cuántas palabras significativas comparte su descripción con
   * lo que el operador va escribiendo (sin acentos, 4+ letras). No usa nada
   * externo: es el propio catálogo del secad leyéndose contra el relato. El
   * operador decide — un clic aplica el código y arrastra el resto del
   * formulario, igual que si lo hubiera digitado.
   */
  readonly sugerenciasCodigo = computed(() => {
    const texto = this.normalizar(this.relato());
    if (texto.length < 8) return [];
    const palabras = new Set(texto.split(/[^a-z0-9]+/).filter((p) => p.length >= 4));
    if (!palabras.size) return [];
    const actual = this.form.controls.codigoCaso.value.trim().toUpperCase();
    return this.codigos()
      .filter((c) => c.activo !== false && c.codigo.toUpperCase() !== actual)
      .map((c) => {
        const desc = this.normalizar(c.descripcion).split(/[^a-z0-9]+/);
        const puntos = desc.filter((p) => p.length >= 4 && palabras.has(p)).length;
        return { codigo: c, puntos };
      })
      .filter((s) => s.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, 3)
      .map((s) => s.codigo);
  });

  aplicarSugerencia(codigo: string): void {
    this.form.controls.codigoCaso.setValue(codigo);
    this.aplicarCodigo();
  }

  /** Minúsculas y sin acentos, para comparar como habla la gente. */
  private normalizar(t: string): string {
    return (t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  esSugerida(agenciaId: string): boolean {
    return this.sugeridaPorCodigo() === agenciaId;
  }

  /** Quién encabeza el caso. Si no se elige, manda la del primer canal marcado. */
  cambiarPrincipal(id: string | null): void {
    this.form.controls.agenciaResponsableId.setValue(id);
  }

  canalMarcado(id: string): boolean {
    return this.canalesMarcados().includes(id);
  }

  alternarCanal(id: string): void {
    this.canalesMarcados.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
    // Si la principal se queda sin canales marcados, deja de encabezar el caso.
    const sigue = this.agenciasMarcadas().some((a) => a.id === this.form.controls.agenciaResponsableId.value);
    if (!sigue) this.form.controls.agenciaResponsableId.setValue(this.agenciasMarcadas()[0]?.id ?? null);
  }

  /** Marca o desmarca de un golpe todos los canales de una entidad. */
  alternarAgencia(agenciaId: string): void {
    const grupo = this.destinos().find((g) => g.agencia.id === agenciaId);
    if (!grupo) return;
    const ids = grupo.canales.map((c) => c.id);
    const actuales = this.canalesMarcados();
    const todos = ids.every((id) => actuales.includes(id));
    this.canalesMarcados.set(
      todos ? actuales.filter((id) => !ids.includes(id)) : [...new Set([...actuales, ...ids])],
    );
    if (!this.agenciasMarcadas().some((a) => a.id === this.form.controls.agenciaResponsableId.value)) {
      this.form.controls.agenciaResponsableId.setValue(this.agenciasMarcadas()[0]?.id ?? null);
    }
  }

  /** Cuántos canales de esa entidad están marcados (para el contador del grupo). */
  marcadosDe(agenciaId: string): number {
    const grupo = this.destinos().find((g) => g.agencia.id === agenciaId);
    return grupo ? grupo.canales.filter((c) => this.canalesMarcados().includes(c.id)).length : 0;
  }

  crear(): void {
    this.error.set('');
    const v = this.form.getRawValue();
    if (!v.ciudadano.trim()) { this.error.set('Indique quién reporta.'); return; }
    if (!v.codigoCaso.trim() && !v.titulo.trim()) {
      this.error.set('Indique el código de caso o un título.'); return;
    }
    const dto: CrearCaso = {
      canal: v.canal,
      titulo: v.titulo.trim() || undefined,
      descripcion: v.descripcion.trim(),
      ciudadano: v.ciudadano.trim(),
      telefono: v.telefono.trim() || undefined,
      direccionLlamante: v.direccionLlamante.trim() || undefined,
      codigoCaso: v.codigoCaso.trim() || undefined,
      prioridad: v.prioridad,
      ciudad: v.ciudad.trim() || undefined,
      barrio: v.barrio.trim() || undefined,
      direccion: v.direccion.trim() || undefined,
      lat: v.lat,
      lng: v.lng,
      agenciaResponsableId: v.agenciaResponsableId ?? undefined,
      canales: this.canalesMarcados(),
    };
    const destino = this.resumenDestino();
    this.guardando.set(true);
    this.casosSvc.crear(dto).subscribe({
      next: (caso) => {
        this.casos.update((cs) => [caso, ...cs]);
        this.guardando.set(false);
        // El caso ya quedó creado con todo lo que se alcanzó a diligenciar
        // mientras el operador hablaba: ahora sí se cierra el círculo con la
        // llamada que lo originó (queda "atendida" y enlazada a este caso).
        const llamada = this.llamadaEnCurso();
        if (llamada) {
          this.llamadaEnCurso.set(null);
          this.pbx.vincular(llamada.id, caso.id).subscribe({ error: () => {} });
        }
        // El id del caso (columna `id` de `casos`) es el identificador
        // primordial del sistema: con él se cruza contra Consulta, reportes e
        // integraciones. Va siempre en el aviso, completo, venga el caso de
        // donde venga.
        const mensaje = destino ? `Caso enviado a ${destino}` : 'Caso recepcionado correctamente';
        // Si además venía de una llamada tomada, se informa aparte: es un id
        // distinto (el de la llamada en la central), no reemplaza al del caso.
        const lineaLlamada = llamada ? `\nLlamada: ${llamada.id.slice(0, 8)}` : '';
        this.toast.exito(`${mensaje}\nId: ${caso.id}${lineaLlamada}`);
        this.limpiarForm();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible crear el caso.');
      },
    });
  }

  // --- Mapa (Leaflet/OpenStreetMap, solo de visualización) --------------------

  /**
   * Carga Leaflet solo cuando hace falta (import dinámico): así el mapa no entra
   * en el paquete inicial ni se ejecuta al prerenderizar, donde no hay ventana.
   */
  /**
   * Leaflet es CommonJS: el import dinámico lo entrega bajo `default`, así que
   * hay que desenvolverlo antes de usarlo.
   */
  private async leaflet(): Promise<typeof import('leaflet')> {
    const mod = await import('leaflet');
    return ((mod as unknown as { default?: typeof import('leaflet') }).default ?? mod);
  }

  /** Centro del mapa al abrir Recepción: el municipio del tenant si se pudo geocodificar; si no, Bogotá de respaldo. */
  private async centroInicial(): Promise<{ centro: [number, number]; zoom: number }> {
    const codigo = this.auth.sesion()?.municipioCodigo;
    if (codigo) {
      const c = await firstValueFrom(this.geografia.centroide(codigo)).catch(() => null);
      if (c) return { centro: [c.lat, c.lng], zoom: 13 };
    }
    return { centro: [4.711, -74.072], zoom: 12 };
  }

  private async prepararMapa(): Promise<void> {
    if (typeof window === 'undefined' || this.mapa) return;
    const div = document.getElementById('mapaCaso');
    if (!div) return;
    const [L, { centro, zoom }] = await Promise.all([this.leaflet(), this.centroInicial()]);
    this.mapa = L.map(div, { zoomControl: true }).setView(centro, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.mapa);
    this.mapa.on('click', (e: import('leaflet').LeafletMouseEvent) => this.alPulsarMapa(e.latlng.lat, e.latlng.lng));
    setTimeout(() => this.mapa?.invalidateSize(), 100);
  }

  private destruirMapa(): void {
    this.mapa?.remove();
    this.mapa = undefined;
    this.marcador = undefined;
  }

  /** Coloca el marcador y refleja las coordenadas en el formulario. */
  private async fijarPunto(lat: number, lng: number, centrar = false): Promise<void> {
    this.form.patchValue({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
    if (!this.mapa) return;
    const L = await this.leaflet();
    // Marcador dibujado en HTML: evita depender de los PNG de Leaflet, que el
    // empaquetador no resuelve.
    const icono = L.divIcon({ className: 'pin-caso', html: '📍', iconSize: [26, 26], iconAnchor: [13, 24] });
    if (this.marcador) this.marcador.setLatLng([lat, lng]);
    else this.marcador = L.marker([lat, lng], { icon: icono }).addTo(this.mapa);
    if (centrar) this.mapa.setView([lat, lng], 16);
  }

  /** Clic en el mapa: fija el punto y resuelve su dirección (Google si está disponible, OSM si no). */
  private alPulsarMapa(lat: number, lng: number): void {
    this.fijarPunto(lat, lng);
    this.geocodificarInverso(lat, lng);
  }

  // --- Buscador de direcciones (Google Places + Geocoding) ---------------------

  /**
   * Monta el buscador estilo Google Maps (escribir → sugerencias → elegir →
   * punto preciso) en el contenedor `#gmpHost` del formulario. Si el backend
   * no tiene la clave configurada, `googleDisponible` queda en `false` y el
   * formulario muestra en su lugar el campo de dirección manual de siempre,
   * con el botón "Buscar en el mapa" resolviendo contra OpenStreetMap.
   */
  private async prepararBuscadorDireccion(): Promise<void> {
    const g = await this.googleMaps.cargar();
    if (!g) { this.googleDisponible.set(false); return; }
    const host = document.getElementById('gmpHost');
    if (!host) return;

    const { PlaceAutocompleteElement } = await g.maps.importLibrary('places');
    this.gmpElement = new PlaceAutocompleteElement({ includedRegionCodes: ['co'] });
    this.gmpElement.placeholder = 'Escriba la dirección del caso…';
    host.appendChild(this.gmpElement);
    this.biasBuscador();

    this.gmpElement.addEventListener('gmp-select', async (ev: google.maps.places.PlacePredictionSelectEvent) => {
      const place = ev.placePrediction.toPlace();
      await place.fetchFields({ fields: ['formattedAddress', 'location', 'addressComponents'] });
      this.alSeleccionarLugar(place);
    });

    // La geocodificación inversa (clic en el mapa) usa el mismo SDK.
    const { Geocoder } = await g.maps.importLibrary('geocoding');
    this.geocoder = new Geocoder();
    this.googleDisponible.set(true);
  }

  /**
   * Acota las sugerencias al municipio elegido en el formulario: sin esto,
   * "Calle 53" sugiere resultados de cualquier ciudad de Colombia. Es un
   * sesgo (`locationBias`), no una restricción dura — un caso cerca del
   * límite municipal sigue apareciendo.
   */
  private biasBuscador(): void {
    if (!this.gmpElement) return;
    const codigo = this.form.controls.municipioCodigo.value;
    if (!codigo) return;
    this.geografia.centroide(codigo).subscribe({
      next: (c) => {
        if (c && this.gmpElement) this.gmpElement.locationBias = { center: { lat: c.lat, lng: c.lng }, radius: 30_000 };
      },
      error: () => {},
    });
  }

  /** Al elegir una sugerencia del buscador: mueve el punto y llena dirección/barrio/municipio con la forma estandarizada de Google. */
  private alSeleccionarLugar(place: google.maps.places.Place): void {
    this.error.set('');
    const lat = place.location?.lat();
    const lng = place.location?.lng();
    const comps = (place.addressComponents ?? []).map((c) => ({ texto: c.longText ?? '', types: c.types }));
    if (lat != null && lng != null) {
      this.aplicarResultado(place.formattedAddress ?? '', lat, lng, comps, true);
    } else {
      this.form.patchValue({ direccion: place.formattedAddress ?? '' });
    }
  }

  /**
   * Del punto a la dirección, al hacer clic en el mapa. Con Google
   * disponible se usa su Geocoder (misma forma estandarizada que el
   * buscador); sin clave configurada, cae al camino de siempre —
   * OpenStreetMap por el backend más Nominatim para barrio/ciudad—.
   */
  private geocodificarInverso(lat: number, lng: number): void {
    if (this.geocoder) {
      this.geocoder.geocode({ location: { lat, lng } }).then(
        ({ results }) => {
          const r = results[0];
          if (!r) return;
          const comps = r.address_components.map((c) => ({ texto: c.long_name, types: c.types }));
          this.aplicarResultado(r.formatted_address, lat, lng, comps, false);
        },
        () => { /* sin dirección: el punto ya quedó fijado, que es lo esencial */ },
      );
      return;
    }
    this.geocodificarInversoOsm(lat, lng);
  }

  /** Aplica una dirección resuelta (Google o el respaldo OSM) al formulario: dirección, barrio y, si calza con el catálogo, el municipio. */
  private aplicarResultado(
    direccion: string,
    lat: number,
    lng: number,
    comps: Array<{ texto: string; types: string[] }>,
    mover: boolean,
  ): void {
    if (mover) this.fijarPunto(lat, lng, true);
    const de = (tipos: string[]) => comps.find((c) => tipos.some((t) => c.types.includes(t)))?.texto;
    const barrio = de(['sublocality', 'sublocality_level_1', 'neighborhood']);
    const municipio = de(['locality', 'administrative_area_level_2']);
    const patch: { direccion: string; barrio?: string; ciudad?: string } = { direccion };
    if (barrio) patch.barrio = barrio;
    if (municipio) {
      const m = this.municipiosTenant().find((x) => this.normalizar(x.nombre) === this.normalizar(municipio));
      if (m) this.form.controls.municipioCodigo.setValue(m.codigoDane, { emitEvent: false });
      else patch.ciudad = municipio;
    }
    this.form.patchValue(patch);
  }

  /**
   * Búsqueda manual: solo hace falta cuando no hay buscador de Google (sin
   * clave configurada) o si el operador escribió texto sin elegir ninguna
   * sugerencia. Con Google disponible usa su Geocoder en modo texto libre;
   * sin él, el camino de siempre contra OpenStreetMap.
   */
  buscarDireccion(): void {
    const v = this.form.getRawValue();
    const texto = v.direccion.trim();
    if (!texto) { this.error.set('Escriba una dirección para buscarla.'); return; }
    this.buscandoDireccion.set(true);
    this.error.set('');

    if (this.geocoder) {
      this.geocoder.geocode({ address: texto, componentRestrictions: { country: 'co' } }).then(
        ({ results }) => {
          this.buscandoDireccion.set(false);
          const r = results[0];
          if (!r) { this.error.set('No se encontró esa dirección.'); return; }
          const comps = r.address_components.map((c) => ({ texto: c.long_name, types: c.types }));
          this.aplicarResultado(r.formatted_address, r.geometry.location.lat(), r.geometry.location.lng(), comps, true);
        },
        () => {
          this.buscandoDireccion.set(false);
          this.error.set('No se encontró esa dirección.');
        },
      );
      return;
    }
    this.buscarDireccionOsm(texto);
  }

  // --- Respaldo (sin clave de Google): OpenStreetMap / Nominatim --------------

  private geocodificarInversoOsm(lat: number, lng: number): void {
    // Dos consultas distintas y complementarias:
    //  · el backend arma la dirección CON numeración («Calle 53 # 52-35»),
    //    que es lo que necesita una unidad en camino. Nominatim devolvía solo
    //    el nombre de la vía, porque en Colombia OSM casi no trae portales.
    //  · Nominatim sigue sirviendo para barrio y ciudad, que sí resuelve bien.
    this.geografia.direccionDe(lat, lng).subscribe({
      next: (d) => { if (d?.direccion) this.form.patchValue({ direccion: this.conMunicipio(d.direccion) }); },
      error: () => { /* sin dirección: quedan barrio y ciudad, que ya es algo */ },
    });

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    fetch(url, { headers: { 'Accept-Language': 'es' } })
      .then((r) => r.json())
      .then((d) => {
        const a = d?.address ?? {};
        const actual = this.form.getRawValue();
        this.form.patchValue({
          barrio: a.neighbourhood ?? a.suburb ?? a.quarter ?? actual.barrio,
          ciudad: a.city ?? a.town ?? a.village ?? a.municipality ?? actual.ciudad,
        });
      })
      .catch(() => { /* barrio y ciudad son ayuda, no requisito: no se alarma al operador */ });
  }

  /** De la dirección al punto, sin Google: acota la búsqueda al municipio elegido, igual que antes. */
  private buscarDireccionOsm(texto: string): void {
    this.geografia.geocodificar(this.conMunicipio(texto), this.form.controls.municipioCodigo.value).subscribe({
      next: (p) => {
        this.buscandoDireccion.set(false);
        if (!p) { this.error.set('No se encontró esa dirección.'); return; }
        this.fijarPunto(p.lat, p.lng, true);
        if (p.precision === 'esquina') {
          this.error.set('Se ubicó la esquina; ajuste el punto si conoce el lugar exacto.');
        } else if (p.precision === 'aproximada') {
          this.error.set('Ubicación aproximada: no se pudo resolver la nomenclatura. Verifique el punto.');
        }
        this.geocodificarInversoOsm(p.lat, p.lng);
      },
      error: () => {
        this.buscandoDireccion.set(false);
        this.error.set('No fue posible buscar la dirección (sin conexión al mapa).');
      },
    });
  }

  // --- Prioridad ----------------------------------------------------------

  prioridadIcon(p: PrioridadCaso): string {
    return { alta: '🔴', media: '🟡', baja: '🟢' }[p];
  }
  prioridadLabel(p: PrioridadCaso): string {
    return { alta: 'Alta', media: 'Media', baja: 'Baja' }[p];
  }
  elegirPrioridad(p: PrioridadCaso): void {
    this.form.controls.prioridad.setValue(p);
  }


  // --- Etiquetas --------------------------------------------------------------

  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c];
  }

  private formVacio() {
    const codigoDefecto = this.auth.sesion()?.municipioCodigo ?? '';
    const municipioDefecto = this.municipiosTenant().find((m) => m.codigoDane === codigoDefecto)?.nombre ?? '';
    return {
      canal: 'llamada' as Canal, ciudadano: '', telefono: '', direccionLlamante: '',
      codigoCaso: '', titulo: '', prioridad: 'media' as PrioridadCaso, descripcion: '',
      ciudad: municipioDefecto, barrio: '', direccion: '',
      municipioCodigo: codigoDefecto,
      lat: null, lng: null,
      agenciaResponsableId: null,
    };
  }
}
