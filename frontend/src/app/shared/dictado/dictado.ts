import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnDestroy, signal } from '@angular/core';
import { FormControl } from '@angular/forms';

/**
 * El API de reconocimiento de voz del navegador (Web Speech API). No todo
 * `lib.dom.d.ts` lo trae completo (falta la interfaz principal y sus
 * eventos, aunque sí trae SpeechRecognitionResult/ResultList/Alternative) —
 * se completa aquí en vez de instalar un paquete de tipos aparte para esto.
 */
declare global {
  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
  }
  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
  }
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((ev: SpeechRecognitionEvent) => void) | null;
    onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
  }
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

/**
 * Botón de micrófono para dictar por voz dentro de un campo de texto — el
 * relato de un caso, el comentario de cierre, el motivo de una reapertura.
 * Usa el reconocimiento de voz que ya trae el navegador (gratis, sin
 * servidor propio): funciona en Chrome y Edge; en los navegadores que no lo
 * traen (Firefox, hoy) el botón simplemente no aparece — el campo sigue
 * funcionando igual, solo sin dictado.
 *
 * El audio se procesa por el propio motor de reconocimiento del navegador
 * (en Chrome/Edge, eso es un servicio de Google) — no pasa por el backend de
 * FALCON en ningún momento.
 */
@Component({
  selector: 'app-dictado',
  standalone: true,
  template: `
    @if (soportado) {
      <button
        type="button"
        class="btn-dictado"
        [class.grabando]="grabando()"
        [attr.aria-pressed]="grabando()"
        [title]="grabando() ? 'Detener el dictado' : 'Dictar por voz'"
        (click)="alternar()"
      >
        {{ grabando() ? '⏹️' : '🎙️' }}
      </button>
    }
  `,
  styles: [`
    .btn-dictado {
      position: absolute; top: 0.4rem; right: 0.4rem;
      width: 1.9rem; height: 1.9rem; border-radius: 50%;
      border: 1px solid var(--border, #d8dee6); background: var(--surface-2, #f1f3f5);
      cursor: pointer; font-size: 0.95rem; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, transform 0.15s;
    }
    .btn-dictado:hover { background: var(--surface-3, #e6e9ec); }
    .btn-dictado.grabando {
      background: #e03131; border-color: #e03131; color: #fff;
      animation: dictado-pulso 1.1s ease-in-out infinite;
    }
    @keyframes dictado-pulso {
      0%, 100% { box-shadow: 0 0 0 0 rgba(224, 49, 49, 0.45); }
      50% { box-shadow: 0 0 0 6px rgba(224, 49, 49, 0); }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DictadoComponent implements OnDestroy {
  /** El control de texto donde se escribe lo dictado. */
  readonly control = input.required<FormControl<string>>();

  readonly grabando = signal(false);
  readonly soportado = !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  private reconocimiento: SpeechRecognition | null = null;
  /** Lo ya confirmado por el reconocedor, más lo que había en el campo antes de empezar a dictar. */
  private base = '';
  /** Se apaga solo (silencio, límite del navegador); reinicia si el usuario no pidió detenerlo. */
  private detenerPedido = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.reconocimiento?.abort());
  }

  alternar(): void {
    if (this.grabando()) this.detener();
    else this.iniciar();
  }

  private iniciar(): void {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const previo = this.control().value?.trim() ?? '';
    this.base = previo ? previo + ' ' : '';
    this.detenerPedido = false;

    const r = new Ctor();
    r.lang = 'es-CO';
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (ev) => {
      let interino = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const transcripcion = ev.results.item(i).item(0).transcript;
        if (ev.results.item(i).isFinal) this.base += transcripcion + ' ';
        else interino += transcripcion;
      }
      this.control().setValue((this.base + interino).trim());
    };

    r.onerror = (ev) => {
      // 'no-speech' es normal (una pausa) — el propio 'onend' que sigue
      // decide si reinicia. El resto sí son motivo para apagar el botón.
      if (ev.error !== 'no-speech') { this.detenerPedido = true; this.grabando.set(false); }
    };

    // Chrome corta el reconocimiento solo tras un silencio, aunque
    // continuous=true — sin este reinicio automático, dictar un relato
    // largo con pausas naturales (como se habla de verdad) se cortaría a
    // cada rato en vez de sentirse fluido.
    r.onend = () => {
      if (this.detenerPedido) { this.grabando.set(false); return; }
      try { r.start(); } catch { this.grabando.set(false); }
    };

    this.reconocimiento = r;
    this.grabando.set(true);
    r.start();
  }

  private detener(): void {
    this.detenerPedido = true;
    this.reconocimiento?.stop();
    this.grabando.set(false);
  }

  ngOnDestroy(): void {
    this.detenerPedido = true;
    this.reconocimiento?.abort();
  }
}
