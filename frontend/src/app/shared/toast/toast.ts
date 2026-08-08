import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toast, ToastService } from './toast.service';

/** Pila de notificaciones popup, montada una sola vez en el shell (y en Login, sin sesión aún). */
@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.html',
  styleUrl: './toast.scss',
})
export class ToastComponent {
  private readonly toastSvc = inject(ToastService);
  readonly toasts = this.toastSvc.toasts;

  icono(tipo: Toast['tipo']): string {
    switch (tipo) {
      case 'exito': return '✓';
      case 'error': return '✕';
      case 'advertencia': return '!';
      default: return 'i';
    }
  }

  cerrar(id: number): void { this.toastSvc.cerrar(id); }
  pausar(id: number): void { this.toastSvc.pausar(id); }
  reanudar(id: number): void { this.toastSvc.reanudar(id); }
}
