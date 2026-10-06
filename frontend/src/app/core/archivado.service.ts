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
  /**
   * Por qué no se puede archivar, en palabras. Distingue «falta la URL» de
   * «la URL está mal escrita», que es el caso que cuesta encontrar.
   */
  motivo: string;
  archivadas: number;
  /** Cuántos días se quedan las grabaciones en la base antes de salir. */
  diasEnBase: number;
  /** El plazo que se usó en ESTA pasada. Distinto de `diasEnBase` solo al probar. */
  diasUsados: number;
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

  /**
   * @param dias Plazo solo para ESTA pasada. Sirve para comprobar la cadena el
   * día que se configura el almacén sin bajar el plazo global —y tener que
   * acordarse de devolverlo, que es como se archiva todo por error—. No se
   * guarda, y no puede alargar el plazo configurado.
   */
  ejecutar(dias?: number): Observable<ResultadoArchivado> {
    return this.http.post<ResultadoArchivado>(
      `${environment.apiBaseUrl}/archivos/archivado/ejecutar`, dias != null ? { dias } : {});
  }
}
