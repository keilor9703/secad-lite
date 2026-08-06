import { EstadoCaso } from '../caso.model';

/** Solicitud de reapertura que deja quien no tiene autorización para reabrir. */
export interface SolicitarReaperturaDto {
  motivo: string;
}

/** Reapertura autorizada: la observación queda en la trazabilidad del caso. */
export interface ReabrirDto {
  motivo: string;
  /** Estado en el que queda al reabrirse; por defecto vuelve a gestión. */
  estado?: EstadoCaso;
}
