import { Injectable, signal } from '@angular/core';

export type ToastTipo = 'exito' | 'error' | 'info' | 'advertencia';

export interface Toast {
  id: number;
  tipo: ToastTipo;
  mensaje: string;
  duracionMs: number;
}

let contador = 0;

/**
 * Notificaciones globales tipo popup: un solo canal para confirmar que algo
 * salió bien y para avisar cuando algo falló. Complementa (no reemplaza) los
 * mensajes inline de cada formulario — en páginas largas (Administración,
 * Catálogos) ese mensaje puede quedar fuera de vista; el toast siempre se ve.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private readonly temporizadores = new Map<number, ReturnType<typeof setTimeout>>();
  /** Instante en que vence cada toast activo (solo mientras corre, no en pausa). */
  private readonly venceEn = new Map<number, number>();
  /** Milisegundos que le quedaban al pausarlo (solo mientras está en pausa). */
  private readonly restante = new Map<number, number>();

  exito(mensaje: string): void { this.mostrar('exito', mensaje, 4200); }
  error(mensaje: string): void { this.mostrar('error', mensaje, 6500); }
  info(mensaje: string): void { this.mostrar('info', mensaje, 4800); }
  advertencia(mensaje: string): void { this.mostrar('advertencia', mensaje, 5500); }

  cerrar(id: number): void {
    const t = this.temporizadores.get(id);
    if (t) clearTimeout(t);
    this.temporizadores.delete(id);
    this.venceEn.delete(id);
    this.restante.delete(id);
    this._toasts.update((ts) => ts.filter((x) => x.id !== id));
  }

  /** El usuario puso el mouse encima: detiene la cuenta regresiva mientras lee. */
  pausar(id: number): void {
    const t = this.temporizadores.get(id);
    if (!t) return;
    clearTimeout(t);
    this.temporizadores.delete(id);
    const vence = this.venceEn.get(id) ?? Date.now();
    this.restante.set(id, Math.max(vence - Date.now(), 300));
    this.venceEn.delete(id);
  }

  /** Reanuda con el tiempo que le quedaba al pausarlo, no con la duración completa. */
  reanudar(id: number): void {
    if (this.temporizadores.has(id)) return;
    const ms = this.restante.get(id);
    if (!ms) return;
    this.restante.delete(id);
    this.iniciar(id, ms);
  }

  private mostrar(tipo: ToastTipo, mensaje: string, duracionMs: number): void {
    const id = ++contador;
    this._toasts.update((ts) => [...ts, { id, tipo, mensaje, duracionMs }]);
    this.iniciar(id, duracionMs);
  }

  private iniciar(id: number, ms: number): void {
    this.venceEn.set(id, Date.now() + ms);
    this.temporizadores.set(id, setTimeout(() => this.cerrar(id), ms));
  }
}
