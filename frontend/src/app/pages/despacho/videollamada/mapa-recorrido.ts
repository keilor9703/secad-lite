import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy,
  computed, effect, input, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { UbicacionCiudadano } from '../../../core/videollamada.service';

/** Zoom al que se acerca cuando solo hay un punto y todavía no hay recorrido. */
const ZOOM_PUNTO = 17;

/**
 * Por dónde va el ciudadano, en vivo, al lado de su video.
 *
 * El despachador necesita las dos cosas a la vez y no una debajo de la otra:
 * la imagen le dice QUÉ está pasando y el mapa DÓNDE. Con la escena a la
 * izquierda y el recorrido a la derecha puede describirle el sitio a la unidad
 * que despacha sin dejar de mirar lo que el ciudadano le está mostrando.
 *
 * La línea importa tanto como el punto: si el ciudadano va caminando, dice
 * hacia dónde se mueve — mandar la patrulla a donde reportó hace cinco minutos
 * es llegar tarde a otro lado.
 */
@Component({
  selector: 'app-mapa-recorrido',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mapa-recorrido.html',
  styleUrl: './mapa-recorrido.scss',
})
export class MapaRecorridoComponent implements OnDestroy {
  readonly puntos = input.required<UbicacionCiudadano[]>();

  private readonly lienzo = viewChild<ElementRef<HTMLDivElement>>('lienzo');

  /** Seguir al ciudadano: recentra solo. Se apaga si el operador explora el mapa. */
  readonly seguir = signal(true);

  readonly ultimo = computed<UbicacionCiudadano | null>(() => {
    const p = this.puntos();
    return p.length ? p[p.length - 1] : null;
  });

  /** Metros recorridos, sumando tramo a tramo. */
  readonly metros = computed(() => {
    const p = this.puntos();
    let total = 0;
    for (let i = 1; i < p.length; i++) total += distancia(p[i - 1], p[i]);
    return Math.round(total);
  });

  private mapa?: import('leaflet').Map;
  private linea?: import('leaflet').Polyline;
  private marca?: import('leaflet').CircleMarker;
  private halo?: import('leaflet').Circle;
  private observador?: ResizeObserver;
  private montando = false;

  constructor() {
    effect(() => {
      const el = this.lienzo()?.nativeElement;
      const puntos = this.puntos();
      if (el) void this.pintar(el, puntos);
    });
  }

  ngOnDestroy(): void {
    this.observador?.disconnect();
    this.mapa?.remove();
    this.mapa = undefined;
  }

  centrar(): void {
    this.seguir.set(true);
    const u = this.ultimo();
    if (u && this.mapa) this.mapa.setView([u.lat, u.lng], Math.max(this.mapa.getZoom(), ZOOM_PUNTO));
  }

  /** Abre la posición actual en un mapa externo, para copiarla o compartirla. */
  urlExterna(): string {
    const u = this.ultimo();
    return u ? `https://www.google.com/maps?q=${u.lat},${u.lng}` : '';
  }

  private async pintar(el: HTMLDivElement, puntos: UbicacionCiudadano[]): Promise<void> {
    if (this.montando) return;
    const L = await this.leaflet();

    if (!this.mapa) {
      this.montando = true;
      this.mapa = L.map(el, { zoomControl: true, attributionControl: false });
      this.mapa.setView([4.6, -74.08], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }).addTo(this.mapa);

      // Si el operador arrastra el mapa, deja de seguir: está mirando otra cosa
      // a propósito y recentrarle la vista cada pocos segundos sería pelear con él.
      this.mapa.on('dragstart', () => this.seguir.set(false));

      // El panel nace angosto y crece: sin esto Leaflet queda con el tamaño
      // que midió al montarse y las teselas salen cortadas.
      this.observador = new ResizeObserver(() => this.mapa?.invalidateSize());
      this.observador.observe(el);
      this.montando = false;
    }

    if (!puntos.length) return;
    const trazo = puntos.map((p): [number, number] => [p.lat, p.lng]);
    const actual = puntos[puntos.length - 1];

    if (this.linea) this.linea.setLatLngs(trazo);
    else this.linea = L.polyline(trazo, { color: '#3fd3e2', weight: 4, opacity: 0.85 }).addTo(this.mapa);

    // Un círculo y no un alfiler: el alfiler apunta a un píxel exacto y aquí la
    // posición tiene un margen de error que hay que mostrar, no esconder.
    if (this.marca) this.marca.setLatLng(actual);
    else this.marca = L.circleMarker(actual, {
      radius: 7, color: '#ffffff', weight: 2, fillColor: '#e8776b', fillOpacity: 1,
    }).addTo(this.mapa);

    const radio = actual.precision ?? 0;
    if (this.halo) { this.halo.setLatLng(actual); this.halo.setRadius(radio); }
    else this.halo = L.circle(actual, {
      radius: radio, color: '#e8776b', weight: 1, opacity: 0.4, fillOpacity: 0.08,
    }).addTo(this.mapa);

    if (!this.seguir()) return;
    if (trazo.length === 1) this.mapa.setView(trazo[0], ZOOM_PUNTO);
    else this.mapa.fitBounds(L.latLngBounds(trazo).pad(0.25), { animate: false });
  }

  /** Leaflet se carga bajo demanda: no pesa en el arranque de Despacho. */
  private async leaflet(): Promise<typeof import('leaflet')> {
    const mod = await import('leaflet');
    return (mod as unknown as { default?: typeof import('leaflet') }).default ?? mod;
  }
}

/** Distancia en metros entre dos puntos (haversine). */
function distancia(a: UbicacionCiudadano, b: UbicacionCiudadano): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
