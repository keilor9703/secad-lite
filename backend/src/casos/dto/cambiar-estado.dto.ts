import { EstadoCaso } from '../caso.model';

export interface CambiarEstadoDto {
  estado: EstadoCaso;
  /** Agencia destino, requerida solo cuando el estado es 'derivado'. */
  agencia?: string;
}
