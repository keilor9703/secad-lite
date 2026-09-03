import { Injectable } from '@angular/core';

/**
 * Notificaciones de escritorio vía Notification API del navegador.
 * Solicita permiso una vez; si se deniega, cae silenciosamente.
 * Útil cuando la pestaña de FALCON CAD está en segundo plano.
 */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private permitido = false;

  constructor() {
    this.solicitarPermiso();
  }

  private async solicitarPermiso(): Promise<void> {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { this.permitido = true; return; }
    if (Notification.permission === 'denied') return;
    const perm = await Notification.requestPermission();
    this.permitido = perm === 'granted';
  }

  notificar(titulo: string, cuerpo: string, icono?: string): void {
    if (!this.permitido || !('Notification' in window)) return;
    try {
      const n = new Notification(titulo, {
        body: cuerpo,
        icon: icono ?? '/favicon.ico',
        tag: 'falcon-cad-caso', // reemplaza la anterior para no acumular
      });
      // Auto-cerrar a los 8 segundos
      setTimeout(() => n.close(), 8000);
    } catch { /* sin soporte o bloqueado */ }
  }
}
