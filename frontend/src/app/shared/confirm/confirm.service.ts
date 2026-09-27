import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  titulo?: string;
  textoAceptar?: string;
  textoCancelar?: string;
  /** Botón de aceptar en rojo, para acciones destructivas (eliminar, rotar una clave). */
  peligro?: boolean;
}

interface ConfirmPeticion {
  mensaje: string;
  titulo: string;
  textoAceptar: string;
  textoCancelar: string;
  peligro: boolean;
}

/**
 * Reemplaza el `confirm()` nativo del navegador por un modal propio,
 * consistente con el resto de la interfaz — el diálogo del navegador no se
 * puede estilizar y queda fuera de lugar en un sistema con temas claro/oscuro.
 *
 * Un solo diálogo activo a la vez: `preguntar()` lo abre y devuelve una
 * promesa que resuelve con la respuesta; `<app-confirm />` (montado una vez
 * en el shell) es quien lo pinta.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _peticion = signal<ConfirmPeticion | null>(null);
  readonly peticion = this._peticion.asReadonly();
  private resolver: ((v: boolean) => void) | null = null;

  preguntar(mensaje: string, opciones?: ConfirmOptions): Promise<boolean> {
    // No debería haber uno ya abierto, pero por si acaso: se cancela el
    // anterior antes de abrir el nuevo, para no dejar una promesa colgada.
    this.resolver?.(false);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
      this._peticion.set({
        mensaje,
        titulo: opciones?.titulo ?? 'Confirmar',
        textoAceptar: opciones?.textoAceptar ?? 'Aceptar',
        textoCancelar: opciones?.textoCancelar ?? 'Cancelar',
        peligro: opciones?.peligro ?? false,
      });
    });
  }

  responder(valor: boolean): void {
    this._peticion.set(null);
    this.resolver?.(valor);
    this.resolver = null;
  }
}
