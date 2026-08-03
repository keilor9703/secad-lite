import { Canal } from '../caso.model';

export interface CrearCasoDto {
  canal: Canal;
  titulo: string;
  descripcion?: string;
  ciudadano: string;
  telefono?: string;
  agencia?: string;
  lat?: number;
  lng?: number;
  /** Uso interno (API entrante): entidad externa que radica el caso. */
  entidadId?: string;
}
