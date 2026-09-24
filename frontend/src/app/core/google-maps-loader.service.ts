import { Injectable, inject } from '@angular/core';
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

  /** `null` si el backend no tiene la clave configurada — el formulario cae a dirección manual, no es un error. */
  cargar(): Promise<typeof google | null> {
    if (!this.cargaPromise) this.cargaPromise = this.cargarInterno();
    return this.cargaPromise;
  }

  private async cargarInterno(): Promise<typeof google | null> {
    const { googleMapsApiKey } = await firstValueFrom(this.geografia.mapasConfig());
    if (!googleMapsApiKey) return null;
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
