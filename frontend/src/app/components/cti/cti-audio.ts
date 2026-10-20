import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';

import { SoftphoneService } from '../../core/softphone/softphone.service';

/**
 * DONDE SUENA LA LLAMADA. NADA MÁS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO VIVE APARTE DEL PANEL
 *
 * Porque el panel vive dentro de Recepción y el enrutador lo destruye al
 * cambiar de pantalla. Si el `<audio>` viviera ahí, abrir un caso a mitad de
 * una llamada dejaría la conversación muda: la sesión SIP seguiría en pie
 * —la lleva el servicio, que es de raíz— pero el flujo de audio se quedaría
 * sin elemento donde reproducir, y el operador no tendría forma de saber qué
 * pasó salvo que el ciudadano dejó de oírse.
 *
 * Así que el audio se monta UNA vez, por encima del enrutador, y el panel se
 * ocupa solo de la interfaz. La llamada sobrevive a navegar; lo que no
 * sobrevive son los controles, y eso es una decisión tomada a propósito: el
 * teléfono se maneja desde Recepción.
 *
 * No pinta nada. Y el elemento NO se oculta con `display:none`: un elemento
 * que no se renderiza puede no reproducir en algunos navegadores, y entonces
 * la llamada entra sin audio sin un solo mensaje que lo explique.
 */
@Component({
  selector: 'app-cti-audio',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<audio #audio autoplay class="cti-audio-global"></audio>`,
  styles: `
    .cti-audio-global {
      position: absolute;
      width: 0;
      height: 0;
      opacity: 0;
      pointer-events: none;
    }
  `,
})
export class CtiAudioComponent {
  private readonly sp = inject(SoftphoneService);
  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');

  constructor() {
    effect(() => {
      const el = this.audio()?.nativeElement;
      if (el) this.sp.usarAudio(el);
    });
  }
}
