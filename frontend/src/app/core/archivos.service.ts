import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Los archivos de un caso: adjuntos y grabaciones.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE EL SERVIDOR YA DECIDE, Y AQUÍ NO SE REPITE
 *
 * **Quién puede ver una grabación.** El listado OMITE las grabaciones a quien
 * no tenga `casos.ver_grabaciones`, y la descarga le responde 403. Así que
 * esta pantalla no filtra nada: lo que llega es lo que esta cuenta puede ver.
 * Repetir aquí la regla sería tener dos sitios donde se decide lo mismo, y el
 * día que cambie, uno de los dos se queda viejo.
 */

export type EstadoArchivo = 'EN_CURSO' | 'COMPLETO' | 'FALLIDO' | 'ARCHIVADO' | 'EN_CUSTODIA';
export type OrigenArchivo = 'ADJUNTO' | 'GRABACION';

export interface ArchivoCaso {
  id: string;
  casoId: string;
  nombre: string;
  tipoMime: string;
  bytes: number;
  estado: EstadoArchivo;
  origen: OrigenArchivo;
  descripcion: string | null;
  /** La llamada telefónica de la que salió, si es la grabación de una. */
  llamadaId: string | null;
  /** La videollamada de la que salió, si es la grabación de una. */
  videoSesionId: string | null;
  creadoEn: string;
}

@Injectable({ providedIn: 'root' })
export class ArchivosService {
  private http = inject(HttpClient);

  listarDeCaso(casoId: string): Observable<ArchivoCaso[]> {
    return this.http.get<ArchivoCaso[]>(`${environment.apiBaseUrl}/casos/${casoId}/archivos`);
  }

  /**
   * El contenido, para reproducirlo.
   *
   * No se puede poner la URL de la API en `<audio src>`: esa ruta exige sesión
   * y un `<audio>` no manda la cabecera `Authorization`. Así que se baja por
   * HttpClient —que sí pasa por el interceptor— y se reproduce desde un
   * `blob:` local. Es el mismo camino que ya usa la grabación de videollamada.
   */
  contenido(archivoId: string): Promise<Blob> {
    return firstValueFrom(this.http.get(
      `${environment.apiBaseUrl}/archivos/${archivoId}/contenido`, { responseType: 'blob' },
    ));
  }
}

/**
 * Las grabaciones de LLAMADA de un caso, de la más reciente a la más vieja.
 *
 * Se distinguen de las de videollamada por `llamadaId`, no por el tipo del
 * archivo: una videollamada también deja un archivo con `origen = GRABACION`,
 * y mezclarlas haría que la grabación de la llamada apareciera dos veces —en
 * la ficha y en la pestaña de videollamadas— o ninguna.
 */
export function grabacionesDeLlamada(archivos: readonly ArchivoCaso[]): ArchivoCaso[] {
  return archivos
    .filter((a) => a.origen === 'GRABACION' && !!a.llamadaId)
    .sort((a, b) => (b.creadoEn ?? '').localeCompare(a.creadoEn ?? ''));
}

/** El tamaño como lo lee una persona. */
export function tamanoLegible(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
