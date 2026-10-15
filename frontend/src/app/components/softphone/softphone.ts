import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { SoftphoneService } from '../../core/softphone/softphone.service';
import { IconoComponent } from '../../shared/icono/icono';

/**
 * El teléfono, dentro de FALCON.
 *
 * Vive por encima del enrutador —como el panel de videollamada— porque una
 * llamada no se puede caer por cambiar de pantalla: el operador contesta
 * mirando la cola y termina escribiendo el caso en Recepción, y es la misma
 * conversación.
 *
 * Se enciende a mano, y eso es deliberado: registrarse toma el micrófono y
 * hace que la central empiece a entregarle llamadas a este navegador. No es
 * algo que deba pasarle a alguien que entró a consultar un caso.
 */
@Component({
  selector: 'app-softphone',
  standalone: true,
  imports: [IconoComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sp.disponible()) {
      <div class="sp" [class.sp--sonando]="!!sp.entrante()">
        <!-- Donde suena la llamada. Sin controles: los de abajo son los
             nuestros, y los del navegador invitan a silenciar el altavoz
             creyendo que se silencia el micrófono. -->
        <audio #audio autoplay></audio>

        <div class="sp-cab">
          <app-icono nombre="telefono" [tam]="15" />
          <strong>Teléfono</strong>
          <span class="badge" [class.on]="sp.estado() === 'registrado'">{{ etiquetaEstado() }}</span>
          @if (sp.estado() === 'apagado') {
            <button type="button" class="btn btn--ghost mini" (click)="sp.encender()">Encender</button>
          } @else {
            <button type="button" class="btn btn--ghost mini" (click)="sp.apagar()">Apagar</button>
          }
        </div>

        @if (sp.motivo(); as m) { <p class="sp-motivo">{{ m }}</p> }

        @if (sp.entrante(); as l) {
          <div class="sp-llamada">
            <p class="sp-num">Entra una llamada de <strong>{{ l.numero || 'número oculto' }}</strong></p>
            <!-- Contestar aquí es UN gesto: acepta el audio y toma la llamada
                 de la cola para este operador. -->
            <div class="sp-acc">
              <button type="button" class="btn" (click)="sp.contestar()">Contestar</button>
              <button type="button" class="btn btn--ghost" (click)="sp.colgar()">Rechazar</button>
            </div>
          </div>
        } @else if (sp.enCurso(); as l) {
          <div class="sp-llamada">
            <p class="sp-num">En llamada con <strong>{{ l.numero || 'número oculto' }}</strong></p>
            <div class="sp-acc">
              <button type="button" class="btn btn--ghost" (click)="sp.alternarSilencio()">
                {{ sp.silenciado() ? 'Reactivar micrófono' : 'Silenciar' }}
              </button>
              <button type="button" class="btn btn--peligro" (click)="sp.colgar()">Colgar</button>
            </div>
          </div>
        }

        @if (sp.avisoCola(); as a) {
          <p class="sp-cola" role="status">
            {{ a }}
            <a routerLink="/recepcion">Ir a Recepción</a>
          </p>
        }
      </div>
    }
  `,
  styles: [`
    .sp {
      position: fixed; right: 1rem; bottom: 1rem; z-index: 60; width: min(22rem, calc(100vw - 2rem));
      padding: .7rem .8rem; border-radius: var(--radio, 10px);
      background: var(--superficie); border: 1px solid var(--borde);
      box-shadow: 0 6px 24px rgb(0 0 0 / 18%); display: grid; gap: .5rem;
      padding-bottom: calc(.8rem + env(safe-area-inset-bottom, 0px));
    }
    .sp--sonando { border-color: var(--acento); }
    .sp-cab { display: flex; align-items: center; gap: .45rem; }
    .sp-cab strong { margin-right: auto; }
    .sp-motivo, .sp-cola { margin: 0; font-size: .82rem; color: var(--texto-apagado); }
    .sp-llamada { display: grid; gap: .45rem; }
    .sp-num { margin: 0; }
    .sp-acc { display: flex; gap: .4rem; flex-wrap: wrap; }
    audio { display: none; }
  `],
})
export class SoftphoneComponent implements AfterViewInit {
  readonly sp = inject(SoftphoneService);
  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');

  ngAfterViewInit(): void {
    const el = this.audio()?.nativeElement;
    if (el) this.sp.usarAudio(el);
  }

  etiquetaEstado(): string {
    return {
      apagado: 'apagado',
      conectando: 'conectando…',
      registrado: 'listo',
      fallo: 'sin conexión',
    }[this.sp.estado()];
  }
}
