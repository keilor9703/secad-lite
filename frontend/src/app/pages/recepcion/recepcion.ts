import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import {
  Agencia, Canal, CanalAtencion, Caso, CodigoCaso, CrearCaso, EstadoCaso, PrioridadCaso,
} from '../../core/models';

/** Lo que el operador diligencia; se traduce a CrearCaso al guardar. */
interface FormRecepcion {
  canal: Canal;
  ciudadano: string;
  telefono: string;
  direccionLlamante: string;
  codigoCaso: string;
  titulo: string;
  prioridad: PrioridadCaso;
  descripcion: string;
  ciudad: string;
  barrio: string;
  direccion: string;
  lat: number | null;
  lng: number | null;
  agenciaResponsableId: string | null;
  canales: string[];
}

@Component({
  selector: 'app-recepcion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recepcion.html',
  styleUrl: './recepcion.scss',
})
export class RecepcionComponent {
  private casosSvc = inject(CasosService);
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);

  readonly casos = signal<Caso[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly guardando = signal(false);

  readonly canales: Canal[] = ['llamada', 'chat', 'whatsapp', 'integracion'];
  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];
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

  /** Entidad de origen: la del funcionario, fija y no editable. */
  readonly agenciaOrigen = computed(() => {
    const id = this.auth.sesion()?.agencia;
    return this.agencias().find((a) => a.id === id) ?? null;
  });

  /** Canales ofrecidos: los de la agencia responsable elegida. */
  readonly canalesDisponibles = computed(() => {
    const id = this.agenciaSeleccionada();
    return id ? this.canalesAtencion().filter((c) => c.agenciaId === id && c.activo) : [];
  });

  /** Señal espejo del select de agencia, para recalcular los canales. */
  private readonly agenciaSeleccionada = signal<string | null>(null);

  mostrarForm = false;
  form: FormRecepcion = this.formVacio();
  /** Hora de apertura del formulario, como referencia visible del registro. */
  abiertoEn = new Date();
  buscandoDireccion = false;

  private mapa?: import('leaflet').Map;
  private marcador?: import('leaflet').Marker;

  constructor() {
    // La bandeja y los catálogos son del tenant activo: si el superadmin cambia
    // de instancia, se recargan solos con los datos de la nueva.
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
      this.cargarCatalogos();
    });
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

  abrirForm(): void {
    this.form = this.formVacio();
    this.agenciaSeleccionada.set(null);
    this.abiertoEn = new Date();
    this.mostrarForm = true;
    this.error.set('');
    // El contenedor del mapa solo existe una vez pintado el formulario.
    setTimeout(() => this.prepararMapa(), 0);
  }

  cerrarForm(): void {
    this.mostrarForm = false;
    this.destruirMapa();
  }

  /**
   * Al elegir el código de caso se traen su descripción, su prioridad y la
   * agencia que suele atenderlo — igual que en el CAD completo, donde la
   * tipificación arrastra el resto del formulario.
   */
  aplicarCodigo(): void {
    const codigo = this.form.codigoCaso.trim().toUpperCase();
    const def = this.codigos().find((c) => c.codigo.toUpperCase() === codigo);
    if (!def) return;
    this.form.titulo = def.descripcion;
    this.form.prioridad = def.prioridad;
    if (def.agenciaSugeridaId) this.cambiarAgencia(def.agenciaSugeridaId);
  }

  cambiarAgencia(id: string | null): void {
    this.form.agenciaResponsableId = id;
    this.form.canales = []; // los canales eran de la agencia anterior
    this.agenciaSeleccionada.set(id);
  }

  canalMarcado(id: string): boolean {
    return this.form.canales.includes(id);
  }

  alternarCanal(id: string): void {
    this.form.canales = this.canalMarcado(id)
      ? this.form.canales.filter((c) => c !== id)
      : [...this.form.canales, id];
  }

  crear(): void {
    this.error.set('');
    if (!this.form.ciudadano.trim()) { this.error.set('Indique quién reporta.'); return; }
    if (!this.form.codigoCaso.trim() && !this.form.titulo.trim()) {
      this.error.set('Indique el código de caso o un título.'); return;
    }
    const dto: CrearCaso = {
      canal: this.form.canal,
      titulo: this.form.titulo.trim() || undefined,
      descripcion: this.form.descripcion.trim(),
      ciudadano: this.form.ciudadano.trim(),
      telefono: this.form.telefono.trim() || undefined,
      direccionLlamante: this.form.direccionLlamante.trim() || undefined,
      codigoCaso: this.form.codigoCaso.trim() || undefined,
      prioridad: this.form.prioridad,
      ciudad: this.form.ciudad.trim() || undefined,
      barrio: this.form.barrio.trim() || undefined,
      direccion: this.form.direccion.trim() || undefined,
      lat: this.form.lat,
      lng: this.form.lng,
      agenciaResponsableId: this.form.agenciaResponsableId ?? undefined,
      canales: this.form.canales,
    };
    this.guardando.set(true);
    this.casosSvc.crear(dto).subscribe({
      next: (caso) => {
        this.casos.update((cs) => [caso, ...cs]);
        this.guardando.set(false);
        this.cerrarForm();
      },
      error: (e) => {
        this.guardando.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible crear el caso.');
      },
    });
  }

  // --- Mapa y geocodificación (OpenStreetMap / Nominatim) ---------------------

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

  private async prepararMapa(): Promise<void> {
    if (typeof window === 'undefined' || this.mapa) return;
    const div = document.getElementById('mapaCaso');
    if (!div) return;
    const L = await this.leaflet();
    this.mapa = L.map(div, { zoomControl: true }).setView([4.711, -74.072], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(this.mapa);
    this.mapa.on('click', (e: import('leaflet').LeafletMouseEvent) => {
      this.fijarPunto(e.latlng.lat, e.latlng.lng);
      this.geocodificarInverso(e.latlng.lat, e.latlng.lng);
    });
    setTimeout(() => this.mapa?.invalidateSize(), 100);
  }

  private destruirMapa(): void {
    this.mapa?.remove();
    this.mapa = undefined;
    this.marcador = undefined;
  }

  /** Coloca el marcador y refleja las coordenadas en el formulario. */
  private async fijarPunto(lat: number, lng: number, centrar = false): Promise<void> {
    this.form.lat = Number(lat.toFixed(6));
    this.form.lng = Number(lng.toFixed(6));
    if (!this.mapa) return;
    const L = await this.leaflet();
    // Marcador dibujado en HTML: evita depender de los PNG de Leaflet, que el
    // empaquetador no resuelve.
    const icono = L.divIcon({ className: 'pin-caso', html: '📍', iconSize: [26, 26], iconAnchor: [13, 24] });
    if (this.marcador) this.marcador.setLatLng([lat, lng]);
    else this.marcador = L.marker([lat, lng], { icon: icono }).addTo(this.mapa);
    if (centrar) this.mapa.setView([lat, lng], 16);
  }

  /** Del punto a la dirección: rellena ciudad, barrio y dirección del caso. */
  private geocodificarInverso(lat: number, lng: number): void {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    fetch(url, { headers: { 'Accept-Language': 'es' } })
      .then((r) => r.json())
      .then((d) => {
        const a = d?.address ?? {};
        const via = [a.road, a.house_number].filter(Boolean).join(' # ');
        if (via) this.form.direccion = via;
        this.form.barrio = a.neighbourhood ?? a.suburb ?? a.quarter ?? this.form.barrio;
        this.form.ciudad = a.city ?? a.town ?? a.village ?? a.municipality ?? this.form.ciudad;
      })
      .catch(() => this.error.set('No fue posible obtener la dirección del punto (sin conexión al mapa).'));
  }

  /** De la dirección al punto: centra el mapa en lo que escribió el operador. */
  buscarDireccion(): void {
    const partes = [this.form.direccion, this.form.barrio, this.form.ciudad].filter((p) => p?.trim());
    if (!partes.length) { this.error.set('Escriba una dirección para buscarla.'); return; }
    this.buscandoDireccion = true;
    const q = encodeURIComponent(partes.join(', '));
    fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
      headers: { 'Accept-Language': 'es' },
    })
      .then((r) => r.json())
      .then((d) => {
        this.buscandoDireccion = false;
        if (!d?.length) { this.error.set('No se encontró esa dirección.'); return; }
        this.fijarPunto(Number(d[0].lat), Number(d[0].lon), true);
      })
      .catch(() => {
        this.buscandoDireccion = false;
        this.error.set('No fue posible buscar la dirección (sin conexión al mapa).');
      });
  }

  // --- Bandeja ----------------------------------------------------------------

  cambiarEstado(caso: Caso, estado: EstadoCaso): void {
    let agencia: string | undefined;
    if (estado === 'derivado') {
      const dest = window.prompt('Agencia destino para derivar:', caso.agencia);
      if (!dest?.trim()) return;
      agencia = dest.trim();
    }
    this.casosSvc.cambiarEstado(caso.id, estado, agencia).subscribe({
      next: (act) => this.casos.update((cs) => cs.map((c) => (c.id === act.id ? act : c))),
      error: () => this.error.set('No fue posible actualizar el estado.'),
    });
  }

  // --- Etiquetas --------------------------------------------------------------

  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', whatsapp: 'WhatsApp', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c];
  }
  estadoLabel(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }

  private formVacio(): FormRecepcion {
    return {
      canal: 'llamada', ciudadano: '', telefono: '', direccionLlamante: '',
      codigoCaso: '', titulo: '', prioridad: 'media', descripcion: '',
      ciudad: '', barrio: '', direccion: '', lat: null, lng: null,
      agenciaResponsableId: null, canales: [],
    };
  }
}
