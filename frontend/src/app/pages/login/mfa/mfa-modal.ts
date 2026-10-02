import {
  ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MfaService, RetoMfa } from '../../../core/mfa.service';
import { Sesion } from '../../../core/models';
import { CodigoCasillasComponent } from './codigo-casillas';

/**
 * Vinculación del primer dispositivo.
 *
 * Esto SÍ es una ventana aparte, y la verificación de cada día no: son dos
 * momentos de peso distinto. Enrolarse ocurre una vez, trae un código QR, tres
 * pasos y una decisión que el usuario no puede deshacer solo — merece que el
 * resto de la pantalla se aparte. Teclear seis dígitos ocurre a diario y no
 * merece interrumpir nada; eso vive desplegado dentro del propio formulario.
 */
@Component({
  selector: 'app-mfa-modal',
  standalone: true,
  imports: [CodigoCasillasComponent],
  templateUrl: './mfa-modal.html',
  styleUrl: './mfa-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaModalComponent implements OnInit {
  readonly reto = input.required<RetoMfa>();

  readonly autenticado = output<Sesion>();
  readonly cancelado = output<void>();

  private readonly mfa = inject(MfaService);
  private readonly saneador = inject(DomSanitizer);

  private readonly casillas = viewChild(CodigoCasillasComponent);

  readonly cargando = signal(false);
  readonly verificando = signal(false);
  readonly error = signal('');

  readonly otpauth = signal('');
  readonly claveManual = signal('');
  private readonly tokenInscripcion = signal('');
  readonly qrSvg = signal<SafeHtml | null>(null);
  readonly verClaveManual = signal(false);

  /** El QR ya está listo: recién entonces tiene sentido pedir el código. */
  readonly listo = computed(() => !!this.qrSvg() || this.verClaveManual());

  ngOnInit(): void {
    void this.pedirQr();
  }

  constructor() {
    effect(() => {
      const uri = this.otpauth();
      if (uri) void this.dibujarQr(uri);
    });
  }

  private async pedirQr(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const r = await this.mfa.iniciarInscripcion(this.reto().reto);
      this.otpauth.set(r.otpauth);
      this.claveManual.set(r.claveManual);
      this.tokenInscripcion.set(r.inscripcion);
    } catch {
      this.error.set('No fue posible generar el código QR. Intente iniciar sesión de nuevo.');
    } finally {
      this.cargando.set(false);
    }
  }

  /**
   * La librería del QR se carga SOLO aquí: son unos 50 kB que no tienen por
   * qué viajar en el paquete inicial, porque la mayoría de las veces el
   * usuario ya está enrolado y nunca ve un QR.
   */
  private async dibujarQr(uri: string): Promise<void> {
    try {
      // `qrcode` es CommonJS: al importarlo de forma dinámica su API queda
      // bajo `.default`, no en la raíz del módulo.
      const modulo = await import('qrcode') as unknown as Record<string, unknown>;
      const qr = (modulo['default'] ?? modulo) as typeof import('qrcode');
      const svg = await qr.toString(uri, {
        type: 'svg', margin: 0, errorCorrectionLevel: 'M',
        color: { dark: '#0b1a26ff', light: '#ffffffff' },
      });
      // Angular SANEA los [innerHTML] y elimina los <svg> por completo. Es
      // seguro saltárselo: el marcado lo produce la librería en este mismo
      // navegador y son solo <path> con la retícula.
      this.qrSvg.set(this.saneador.bypassSecurityTrustHtml(svg));
    } catch (e) {
      console.error('[2FA] No se pudo dibujar el código QR:', e);
      this.verClaveManual.set(true);
    }
  }

  async confirmar(codigo: string): Promise<void> {
    if (this.verificando()) return;
    this.verificando.set(true);
    this.error.set('');
    try {
      const sesion = await this.mfa.confirmarInscripcion(
        this.reto().reto, this.tokenInscripcion(), codigo);
      this.autenticado.emit(sesion);
    } catch (e) {
      this.error.set((e as { error?: { message?: string } })?.error?.message
        ?? 'No fue posible verificar el código.');
      this.casillas()?.limpiar();
    } finally {
      this.verificando.set(false);
    }
  }

  async copiarClave(): Promise<void> {
    try { await navigator.clipboard?.writeText(this.claveManual()); } catch { /* ahí está para leerla */ }
  }
}
