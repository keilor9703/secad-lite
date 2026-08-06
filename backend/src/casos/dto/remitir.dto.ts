/**
 * Remisión de un caso a canales de atención. Sirve tanto para sumar canales
 * (gestión conjunta: varias entidades atienden a la vez) como para trasladarlo
 * a otra agencia dejándolo fuera de la cola anterior.
 */
export interface RemitirDto {
  /** Agencia destino (agencias.id). Si se omite, se mantiene la responsable. */
  agenciaResponsableId?: string;
  /** Canales destino, todos de esa agencia. */
  canales: string[];
  /** Motivo de la remisión; queda en la bitácora. */
  observacion?: string;
  /**
   * `true` traslada el caso: los canales indicados reemplazan a los anteriores
   * y el caso desaparece de la cola de la agencia previa. `false` (por defecto)
   * los suma, para que ambas entidades lo atiendan.
   */
  exclusivo?: boolean;
}
