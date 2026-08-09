import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { DespachoService } from '../../core/despacho.service';
import { AuthService } from '../../core/auth.service';
import { Caso, Recurso } from '../../core/models';

/**
 * Mapa operativo: los casos abiertos y la flota, juntos y en vivo. Es la vista
 * de conjunto que el tablero (columnas) no puede dar: DÓNDE está pasando todo
 * y dónde están las unidades para responder. Se refresca solo cada 30 s.
 */
@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mapa.html',
  styleUrl: './mapa.scss',
})
export class MapaComponent implements OnInit, OnDestroy {
  private casosSvc = inject(CasosService);
  private despachoSvc = inject(DespachoService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly casos = signal<Caso[]>([]);
  readonly recursos = signal<Recurso[]>([]);
  readonly error = signal('');
  readonly actualizadoEn = signal<Date | null>(null);

  readonly casosUbicados = computed(() => this.casos().filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number'));
  readonly recursosUbicados = computed(() => this.recursos().filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number'));
  readonly sinUbicar = computed(() => this.casos().length - this.casosUbicados().length);

  private mapa?: import('leaflet').Map;
  private capa?: import('leaflet').LayerGroup;
  private refresco?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    setTimeout(() => this.prepararMapa(), 0);
    this.cargar();
    this.refresco = setInterval(() => { if (!document.hidden) this.cargar(); }, 30_000);
  }

  ngOnDestroy(): void {
    if (this.refresco) clearInterval(this.refresco);
    this.mapa?.remove();
  }

  cargar(): void {
    this.casosSvc.listar({ abiertos: true, limite: 500 }).subscribe({
      next: (cs) => { this.casos.set(cs); this.pintar(); this.actualizadoEn.set(new Date()); },
      error: () => this.error.set('No fue posible cargar los casos.'),
    });
    this.despachoSvc.listarRecursos().subscribe({
      next: (rs) => { this.recursos.set(rs); this.pintar(); },
      error: () => {},
    });
  }

  /** Leaflet es CommonJS: el import dinámico lo entrega bajo `default`. */
  private async leaflet(): Promise<typeof import('leaflet')> {
    const mod = await import('leaflet');
    return ((mod as unknown as { default?: typeof import('leaflet') }).default ?? mod);
  }

  private async prepararMapa(): Promise<void> {
    if (typeof window === 'undefined' || this.mapa) return;
    const div = document.getElementById('mapaOperativo');
    if (!div) return;
    const L = await this.leaflet();
    this.mapa = L.map(div, { zoomControl: true }).setView([4.711, -74.072], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(this.mapa);
    this.capa = L.layerGroup().addTo(this.mapa);
    this.pintar();
    setTimeout(() => this.mapa?.invalidateSize(), 100);
  }

  /**
   * Redibuja la capa completa con la tanda vigente. El texto de los popups se
   * arma con textContent (nunca innerHTML con datos del ciudadano): lo que
   * alguien haya escrito en un título no puede ejecutar nada aquí.
   */
  private async pintar(): Promise<void> {
    if (!this.mapa || !this.capa) return;
    const L = await this.leaflet();
    this.capa.clearLayers();

    const puntos: Array<[number, number]> = [];

    for (const c of this.casosUbicados()) {
      const icono = L.divIcon({
        className: '', iconSize: [22, 22], iconAnchor: [11, 11],
        html: `<span class="pin-caso-op" data-prio="${c.prioridad ?? 'media'}"></span>`,
      });
      const marcador = L.marker([c.lat!, c.lng!], { icon: icono }).addTo(this.capa);
      const cont = document.createElement('div');
      const titulo = document.createElement('strong');
      titulo.textContent = c.titulo;
      const linea = document.createElement('div');
      linea.textContent = `${c.agencia} · ${c.estado} · prioridad ${c.prioridad ?? 'media'}`;
      const enlace = document.createElement('a');
      enlace.textContent = 'Abrir caso →';
      enlace.href = '#';
      enlace.onclick = (ev) => { ev.preventDefault(); this.abrirCaso(c); };
      cont.append(titulo, linea, enlace);
      marcador.bindPopup(cont);
      puntos.push([c.lat!, c.lng!]);
    }

    for (const r of this.recursosUbicados()) {
      const icono = L.divIcon({
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<span class="pin-recurso" data-estado="${r.estado}">${this.emojiRecurso(r)}</span>`,
      });
      const marcador = L.marker([r.lat!, r.lng!], { icon: icono }).addTo(this.capa);
      const cont = document.createElement('div');
      cont.textContent = `${r.codigo} — ${r.nombre} (${this.estadoRecursoLabel(r)})`;
      marcador.bindPopup(cont);
      puntos.push([r.lat!, r.lng!]);
    }

    // Encuadre inicial: una sola vez, cuando ya hay algo que mostrar.
    if (!this.encuadrado && puntos.length) {
      this.encuadrado = true;
      this.mapa.fitBounds(L.latLngBounds(puntos).pad(0.2));
    }
  }

  private encuadrado = false;

  /** A dónde se abre el caso depende del rol: despachador al tablero, resto al detalle. */
  private abrirCaso(c: Caso): void {
    if (this.auth.tienePermiso('despacho.ver')) {
      this.router.navigate(['/despacho'], { queryParams: { caso: c.id } });
    } else {
      this.router.navigate(['/caso', c.id]);
    }
  }

  emojiRecurso(r: Recurso): string {
    return { patrulla: '🚓', ambulancia: '🚑', maquina: '🚒', moto: '🏍', otro: '🚙' }[r.tipo] ?? '🚙';
  }

  estadoRecursoLabel(r: Recurso): string {
    return { disponible: 'disponible', asignado: 'asignado', en_ruta: 'en ruta', en_sitio: 'en sitio', fuera_servicio: 'fuera de servicio' }[r.estado] ?? r.estado;
  }
}
