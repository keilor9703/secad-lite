import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';

import { ConfirmService } from './confirm.service';

/** Modal de confirmación global, montado una sola vez en el shell (y en Login). */
@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [],
  templateUrl: './confirm.html',
  styleUrl: './confirm.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'cancelar()' },
})
export class ConfirmComponent {
  private readonly svc = inject(ConfirmService);
  readonly peticion = this.svc.peticion;
  private readonly botonAceptar = viewChild<ElementRef<HTMLButtonElement>>('botonAceptar');

  constructor() {
    // Foco en "Aceptar" al abrir: mismo comportamiento que el confirm()
    // nativo (responde con Enter), sin que el usuario tenga que buscar el
    // ratón para una acción que antes era instantánea.
    effect(() => {
      if (this.peticion()) queueMicrotask(() => this.botonAceptar()?.nativeElement.focus());
    });
  }

  aceptar(): void { this.svc.responder(true); }
  cancelar(): void { this.svc.responder(false); }
}
