import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { GeografiaService } from './geografia.service';

/**
 * Carga perezosa del SDK de Google Maps (Places + Geocoding), para el
 * buscador de direcciones de Recepción.
 *
 * La clave no viaja en el bundle (ver `GeografiaService.mapasConfig`): se
 * pide al backend la primera vez que hace falta, así se puede rotar sin
 * reconstruir el frontend. La carga del script queda memoizada — aunque el
 * operador limpie el formulario y vuelva a necesitar el buscador, el script
 * de Google solo se pide una vez por sesión de pestaña.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoaderService {
  private geografia = inject(GeografiaService);
  private cargaPromise?: Promise<typeof google | null>;

  /**
   * Google rechazó la clave en tiempo de ejecución: cuota agotada, clave
   * caducada, referente no permitido, facturación caída. Lo avisa por
   * `window.gm_authFailure`, un enganche global que hay que poner a mano y que
   * no estábamos usando — por eso el mapa se quedaba con el cartel de error de
   * Google en vez de caer al de OpenStreetMap, que sí habría funcionado.
   */
  readonly fallo = signal(false);

  /** `null` si el backend no tiene la clave configurada — el formulario cae a dirección manual, no es un error. */
  cargar(): Promise<typeof google | null> {
    // Si Google ya rechazó la clave, no tiene sentido volver a intentarlo en
    // esta pestaña: se responde `null` y quien llame usa su respaldo.
    if (this.fallo()) return Promise.resolve(null);
    if (!this.cargaPromise) {
      this.cargaPromise = this.cargarInterno().catch((e) => {
        // Memorizar una promesa RECHAZADA dejaba el mapa roto para el resto de
        // la sesión: un corte de red de un segundo al arrancar y ya no había
        // forma de recuperarse sin recargar la página entera.
        this.cargaPromise = undefined;
        throw e;
      });
    }
    return this.cargaPromise;
  }

  /**
   * Map ID de la consola de Google, para el mapa de Recepción. Nulo mientras no
   * se configure; ver `mapId` en `prepararMapaGoogle` para qué pasa entonces.
   */
  mapId: string | null = null;

  private async cargarInterno(): Promise<typeof google | null> {
    const { googleMapsApiKey, googleMapsMapId } = await firstValueFrom(this.geografia.mapasConfig());
    if (!googleMapsApiKey) return null;
    this.mapId = googleMapsMapId;
    this.inyectarBootstrap(googleMapsApiKey);
    // El buscador (Places) y la geocodificación inversa (clic en el mapa)
    // son las dos únicas bibliotecas que usa este formulario.
    await Promise.all([
      google.maps.importLibrary('places'),
      google.maps.importLibrary('geocoding'),
    ]);
    return google;
  }

  /**
   * El cargador oficial de Google Maps: inyecta un `<script>` async y deja
   * `google.maps.importLibrary` listo para pedir cada biblioteca bajo
   * demanda. No se reescribe a mano: es el snippet que entrega la propia
   * consola de Google Cloud al activar la clave.
   */
  private inyectarBootstrap(key: string): void {
    if ((window as unknown as { google?: { maps?: { importLibrary?: unknown } } }).google?.maps?.importLibrary) return;
    // El aviso de Google cuando rechaza la clave. Es una función global con
    // nombre fijo; no hay otra forma de enterarse desde el código.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      console.warn('Google rechazó la clave de Maps (cuota, facturación, restricciones). Se usa OpenStreetMap.');
      this.fallo.set(true);
    };
    ((g: { key: string; v: string }) => {
      let h: Promise<void> | undefined;
      let a: HTMLScriptElement;
      let k: string;
      const p = 'The Google Maps JavaScript API';
      const c = 'google';
      const l = 'importLibrary';
      const q = '__ib__';
      const m = document;
      let b = window as unknown as Record<string, any>;
      b = b[c] || (b[c] = {});
      const d = b['maps'] || (b['maps'] = {});
      const r = new Set<string>();
      const e = new URLSearchParams();
      const u = () =>
        h ||
        (h = new Promise<void>((f, n) => {
          a = m.createElement('script');
          e.set('libraries', [...r] + '');
          for (k in g) e.set(k.replace(/[A-Z]/g, (t) => '_' + t[0].toLowerCase()), (g as Record<string, string>)[k]);
          e.set('callback', c + '.maps.' + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          (d as Record<string, unknown>)[q] = f;
          a.onerror = () => { h = undefined; n(Error(p + ' could not load.')); };
          a.nonce = (m.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce || '';
          m.head.append(a);
        }));
      (d as Record<string, unknown>)[l]
        ? console.warn(p + ' only loads once. Ignoring:', g)
        : ((d as Record<string, unknown>)[l] = (f: string, ...n: unknown[]) => r.add(f) && u().then(() => (d as Record<string, any>)[l](f, ...n)));
    })({ key, v: 'weekly' });
  }
}
