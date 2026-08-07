import { EstadoCaso } from '../caso.model';

export interface CambiarEstadoDto {
  estado: EstadoCaso;
  /** Agencia destino, requerida solo cuando el estado es 'derivado'. */
  agencia?: string;
  /** Obligatorio al cerrar: cómo terminó el caso (ver CODIGOS_CIERRE). */
  codigoCierre?: string;
  /** Obligatorio al cerrar: qué pasó, en palabras del despachador. */
  comentario?: string;
}
