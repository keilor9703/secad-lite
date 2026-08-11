import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { AnalisisMapa, MetricasService, PuntoMapa } from '../../core/metricas.service';
import { CodigoCaso } from '../../core/models';

type ModoVista = 'calor' | 'cluster' | 'puntos';

interface Barra { etiqueta: string; valor: number; }

/**
 * Mapa estadístico: NO rastrea recursos (el sistema no guarda su ubicación).
 * Es un análisis del delito y de la convivencia y seguridad ciudadana a
 * partir de dónde y cuándo han ocurrido los casos históricos del tenant:
 * puntos, cluster y calor por ubicación, más días/horas de mayor afectación
 * y el top 5 de códigos de caso. Filtrable por rango de fechas y código.
 */
@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mapa.html',
  styleUrl: './mapa.scss',
})
export class MapaComponent implements OnInit, OnDestroy {
  private metricasSvc = inject(MetricasService);
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly analisis = signal<AnalisisMapa | null>(null);
  readonly codigos = signal<CodigoCaso[]>([]);
  readonly cargando = signal(true);
  readonly error = signal('');
  readonly modoVista = signal<ModoVista>('calor');

  desde = '';
  hasta = '';
  codigoSel = '';

  /** Sin `casos.ver` el popup no debe ofrecer un enlace que llevaría a un 403. */
  readonly puedeAbrirCaso = this.auth.tienePermiso('casos.ver');

  private readonly diaLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  /** La semana se muestra empezando en lunes, aunque PostgreSQL numera desde domingo (DOW=0). */
  private readonly ordenDias = [1, 2, 3, 4, 5, 6, 0];

  readonly porDiaSemana = computed<Barra[]>(() => {
    const a = this.analisis();
    if (!a) return [];
    return this.ordenDias.map((dia) => ({
      etiqueta: this.diaLabels[dia],
      valor: a.porDiaSemana.find((d) => d.dia === dia)?.total ?? 0,
    }));
  });

  readonly porHora = computed<Barra[]>(() => {
    const a = this.analisis();
    if (!a) return [];
    return a.porHora.map((h) => ({ etiqueta: `${String(h.hora).padStart(2, '0')}:00`, valor: h.total }));
  });

  readonly topCodigos = computed(() => this.analisis()?.topCodigos ?? []);
  readonly maxTopCodigo = computed(() => Math.max(1, ...this.topCodigos().map((c) => c.total)));

  readonly diaPico = computed(() => this.pico(this.porDiaSemana()));
  readonly horaPico = computed(() => this.pico(this.porHora()));

  readonly totalCasos = computed(() => {
    const a = this.analisis();
    return a ? a.totalConUbicacion + a.totalSinUbicacion : 0;
  });

  private pico(serie: Barra[]): Barra | null {
    return serie.reduce<Barra | null>((m, b) => (!m || b.valor > m.valor ? b : m), null);
  }

  /** Porcentaje relativo al máximo de la serie, para el ancho de la barra. */
  pct(valor: number, serie: Barra[]): number {
    const max = Math.max(1, ...serie.map((b) => b.valor));
    return Math.round((valor / max) * 100);
  }

  private mapa?: import('leaflet').Map;
  private capaPuntos?: import('leaflet').LayerGroup;
  private capaCluster?: import('leaflet').MarkerClusterGroup;
  private capaCalor?: import('leaflet').HeatLayer;
  private encuadrado = false;

  ngOnInit(): void {
    setTimeout(() => this.prepararMapa(), 0);
    this.catalogos.codigos(true).subscribe({ next: (c) => this.codigos.set(c), error: () => {} });
    this.cargar();
  }

  ngOnDestroy(): void {
    this.mapa?.remove();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.metricasSvc
      .mapa({ desde: this.desde || undefined, hasta: this.hasta || undefined, codigo: this.codigoSel || undefined })
      .subscribe({
        next: (a) => { this.analisis.set(a); this.cargando.set(false); this.pintar(); },
        error: () => { this.error.set('No fue posible cargar el mapa.'); this.cargando.set(false); },
      });
  }

  aplicarFechas(): void {
    if (this.desde && this.hasta && this.desde > this.hasta) [this.desde, this.hasta] = [this.hasta, this.desde];
    this.cargar();
  }

  limpiarFiltros(): void {
    this.desde = this.hasta = this.codigoSel = '';
    this.cargar();
  }

  cambiarVista(modo: ModoVista): void {
    this.modoVista.set(modo);
    this.pintar();
  }

  /** Leaflet y sus plugins de calor/cluster son CommonJS y dependen de un `L` global. */
  private async leaflet(): Promise<typeof import('leaflet')> {
    const mod = await import('leaflet');
    const L = (mod as unknown as { default?: typeof import('leaflet') }).default ?? mod;
    (window as unknown as { L: typeof import('leaflet') }).L = L;
    await import('leaflet.heat');
    await import('leaflet.markercluster');
    return L;
  }

  private async prepararMapa(): Promise<void> {
    if (typeof window === 'undefined' || this.mapa) return;
    const div = document.getElementById('mapaCasos');
    if (!div) return;
    const L = await this.leaflet();
    this.mapa = L.map(div, { zoomControl: true }).setView([4.6, -74.08], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(this.mapa);
    this.capaPuntos = L.layerGroup();
    this.capaCluster = L.markerClusterGroup();
    this.capaCalor = L.heatLayer([], { radius: 22, blur: 18, maxZoom: 16 });
    await this.pintar();
    setTimeout(() => this.mapa?.invalidateSize(), 100);
  }

  /** Redibuja SOLO la capa del modo activo; las otras se desmontan. */
  private async pintar(): Promise<void> {
    if (!this.mapa) return;
    const L = await this.leaflet();
    const puntos = this.analisis()?.puntos ?? [];

    for (const capa of [this.capaPuntos, this.capaCluster, this.capaCalor]) {
      if (capa && this.mapa.hasLayer(capa)) this.mapa.removeLayer(capa);
    }

    if (this.modoVista() === 'calor') {
      // leaflet.heat calcula setLatLngs()→redraw() contra this._map sin
      // comprobar que exista: si se llama con la capa recién desmontada (el
      // remove-loop de arriba), _map ya es null pero _heat sigue viva desde
      // el montaje anterior, y revienta leyendo _map._animating. Por eso hay
      // que montarla ANTES de cargarle los puntos, no después.
      if (this.capaCalor) this.mapa.addLayer(this.capaCalor);
      const datos: Array<[number, number, number]> = puntos.map((p) => [p.lat, p.lng, this.pesoPrioridad(p.prioridad)]);
      this.capaCalor?.setLatLngs(datos);
    } else if (this.modoVista() === 'cluster') {
      this.capaCluster?.clearLayers();
      for (const p of puntos) this.capaCluster?.addLayer(this.marcador(L, p));
      if (this.capaCluster) this.mapa.addLayer(this.capaCluster);
    } else {
      this.capaPuntos?.clearLayers();
      for (const p of puntos) this.marcador(L, p).addTo(this.capaPuntos!);
      if (this.capaPuntos) this.mapa.addLayer(this.capaPuntos);
    }

    // Encuadre inicial: una sola vez, cuando ya hay algo que mostrar.
    if (!this.encuadrado && puntos.length) {
      this.encuadrado = true;
      this.mapa.fitBounds(L.latLngBounds(puntos.map((p): [number, number] => [p.lat, p.lng])).pad(0.2));
    }
  }

  /**
   * El popup se arma con textContent (nunca innerHTML con datos del
   * ciudadano): lo que alguien haya escrito en un título no puede ejecutar
   * nada aquí.
   */
  private marcador(L: typeof import('leaflet'), p: PuntoMapa): import('leaflet').Marker {
    const icono = L.divIcon({
      className: '', iconSize: [16, 16], iconAnchor: [8, 8],
      html: `<span class="pin-caso" data-prio="${p.prioridad ?? 'media'}"></span>`,
    });
    const marcador = L.marker([p.lat, p.lng], { icon: icono });
    const cont = document.createElement('div');
    const titulo = document.createElement('strong');
    titulo.textContent = p.titulo;
    const linea = document.createElement('div');
    linea.textContent = `${p.codigoCaso ?? 'Sin código'} · prioridad ${p.prioridad} · ${new Date(p.creadoEn).toLocaleString()}`;
    cont.append(titulo, linea);
    if (this.puedeAbrirCaso) {
      const enlace = document.createElement('a');
      enlace.textContent = 'Abrir caso →';
      enlace.href = '#';
      enlace.onclick = (ev) => { ev.preventDefault(); this.router.navigate(['/caso', p.id]); };
      cont.append(enlace);
    }
    marcador.bindPopup(cont);
    return marcador;
  }

  private pesoPrioridad(p: string): number {
    return ({ alta: 1, media: 0.6, baja: 0.3 } as Record<string, number>)[p] ?? 0.5;
  }
}
