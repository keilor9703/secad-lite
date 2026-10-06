import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Lo que responde el barrido de archivado. */
export interface ResultadoArchivado {
  /**
   * ¿Hay a dónde archivar? `false` significa que falta `ARCHIVO_OBJETOS_URL`:
   * las grabaciones se quedan en la base y el disco crece. Es lo primero que
   * hay que descartar cuando «no archiva nada».
   */
  configurado: boolean;
  archivadas: number;
  /** Cuántos días se quedan las grabaciones en la base antes de salir. */
  diasEnBase: number;
}

/**
 * Archivado de grabaciones, a petición.
 *
 * El barrido corre solo a las 3:19. Esto existe para no esperar a mañana el
 * día que se configura el almacén —y para poder archivar antes de una ventana
 * de mantenimiento—. Es la misma tarea del cron, con su mismo bloqueo.
 */
@Injectable({ providedIn: 'root' })
export class ArchivadoService {
  private http = inject(HttpClient);

  ejecutar(): Observable<ResultadoArchivado> {
    return this.http.post<ResultadoArchivado>(
      `${environment.apiBaseUrl}/archivos/archivado/ejecutar`, {});
  }
}
