import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MapaRecorridoComponent } from './mapa-recorrido';
import { GoogleMapsLoaderService } from '../../../core/google-maps-loader.service';
import { UbicacionCiudadano } from '../../../core/videollamada.service';

/**
 * El panel que mira el despachador mientras habla con quien pide ayuda.
 *
 * Lo que se prueba aquí no es el dibujo —eso lo hace Google— sino las dos
 * cosas que sí son decisión nuestra y que fallan en silencio:
 *
 *  1. Que haya mapa SIEMPRE. Con clave de Google va por Google; sin ella, por
 *     OpenStreetMap. Un panel en blanco durante una emergencia no es una
 *     degradación aceptable, y ya vivimos una vez sin facturación.
 *  2. Que al llegar cada punto nuevo se ACTUALICEN la línea, el punto y el
 *     halo, en vez de crear unos nuevos encima. La ubicación llega cada pocos
 *     segundos durante toda la llamada: apilar objetos deja el mapa pintado de
 *     líneas viejas y se come la memoria de la pestaña.
 */

/** Un doble del SDK de Google: cuenta cuántas veces se construye cada cosa. */
function googleFalso() {
  const cuentas = { mapas: 0, lineas: 0, marcas: 0, circulos: 0 };
  const posicionados: Array<{ setPath?: unknown }> = [];

  class Map {
    constructor() { cuentas.mapas++; }
    addListener() { return { remove() {} }; }
    setCenter() {} setZoom() {} getZoom() { return 12; } fitBounds() {}
  }
  class Polyline {
    constructor() { cuentas.lineas++; }
    setPath() {} setMap() {}
  }
  class Circle {
    constructor() { cuentas.circulos++; }
    setCenter() {} setRadius() {} setMap() {}
  }
  class AdvancedMarkerElement {
    position: unknown; map: unknown;
    constructor() { cuentas.marcas++; }
  }
  class LatLngBounds { extend() {} }

  const g = {
    maps: {
      Map, Polyline, Circle, LatLngBounds,
      importLibrary: (n: string) => Promise.resolve(n === 'marker' ? { AdvancedMarkerElement } : { Map }),
    },
  } as unknown as typeof google;

  return { g, cuentas, posicionados };
}

const punto = (lat: number, lng: number): UbicacionCiudadano =>
  ({ lat, lng, precision: 25 } as UbicacionCiudadano);

/**
 * Espera a que se cumpla una condición, sondeando.
 *
 * Hace falta porque pintar es una cadena de promesas —`cargar()`, luego
 * `importLibrary()`— y `whenStable()` resuelve antes de que termine: la
 * primera versión de estas pruebas pasaba con el mapa a medio montar y no
 * comprobaba nada. Si la condición no se cumple, falla por tiempo en vez de
 * seguir con una aserción engañosa.
 */
async function esperarA(cond: () => boolean, que: string, ms = 2000): Promise<void> {
  const hasta = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > hasta) throw new Error(`Nunca ocurrió: ${que}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('MapaRecorridoComponent — siempre hay mapa', () => {
  let falso: ReturnType<typeof googleFalso>;

  function montar(conGoogle: boolean) {
    falso = googleFalso();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: GoogleMapsLoaderService,
          useValue: { mapId: 'abc123', cargar: () => Promise.resolve(conGoogle ? falso.g : null) },
        },
      ],
    });
    const fixture = TestBed.createComponent(MapaRecorridoComponent);
    fixture.componentRef.setInput('puntos', []);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con clave de Google dibuja sobre Google', async () => {
    const f = montar(true);
    f.componentRef.setInput('puntos', [punto(6.17, -75.61)]);
    f.detectChanges();
    await esperarA(() => falso.cuentas.circulos > 0, 'se dibujó el halo');
    expect(falso.cuentas.mapas).withContext('se montó el mapa de Google').toBe(1);
    expect(falso.cuentas.lineas).withContext('la línea del recorrido').toBe(1);
    expect(falso.cuentas.marcas).withContext('el punto actual').toBe(1);
    expect(falso.cuentas.circulos).withContext('el halo de precisión').toBe(1);
  });

  it('sin clave NO se queda en blanco: cae a OpenStreetMap', async () => {
    const f = montar(false);
    f.componentRef.setInput('puntos', [punto(6.17, -75.61)]);
    f.detectChanges();
    // Leaflet monta su contenedor con esta clase; es la prueba de que hay mapa.
    await esperarA(() => !!f.nativeElement.querySelector('.leaflet-container'), 'montó el mapa de Leaflet');
    expect(falso.cuentas.mapas).withContext('no se usó Google').toBe(0);
  });

  it('cada punto nuevo ACTUALIZA; no apila líneas ni marcas', async () => {
    const f = montar(true);
    const recorrido = [punto(6.17, -75.61)];
    f.componentRef.setInput('puntos', [...recorrido]);
    f.detectChanges();
    await esperarA(() => falso.cuentas.circulos > 0, 'primer dibujo');

    for (const p of [punto(6.171, -75.611), punto(6.172, -75.612), punto(6.173, -75.613)]) {
      recorrido.push(p);
      f.componentRef.setInput('puntos', [...recorrido]);
      f.detectChanges();
      await new Promise((r) => setTimeout(r, 30));
    }

    expect(falso.cuentas.mapas).withContext('un solo mapa en toda la llamada').toBe(1);
    expect(falso.cuentas.lineas).withContext('una sola polilínea, actualizada').toBe(1);
    expect(falso.cuentas.marcas).withContext('un solo punto, movido').toBe(1);
    expect(falso.cuentas.circulos).withContext('un solo halo, recentrado').toBe(1);
  });

  it('arrastrar el mapa apaga el seguimiento automático', async () => {
    const f = montar(true);
    const c = f.componentInstance;
    expect(c.seguir()).toBeTrue();
    c.seguir.set(false);
    expect(c.seguir()).withContext('y centrar() lo vuelve a encender').toBeFalse();
    c.centrar();
    expect(c.seguir()).toBeTrue();
  });
});
