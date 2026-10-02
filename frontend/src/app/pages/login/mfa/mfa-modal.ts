import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit,
  computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MfaService, RetoMfa } from '../../../core/mfa.service';
import { Sesion } from '../../../core/models';

/** Los seis dígitos, en seis casillas. */
const DIGITOS = 6;

/**
 * Doble factor en el inicio de sesión.
 *
 * Dos momentos en la misma ventana, porque para el usuario son el mismo
 * trámite: la primera vez vincula su teléfono escaneando un QR, y de ahí en
 * adelante solo teclea los seis dígitos.
 *
 * No se puede cerrar con la tecla de escape ni pulsando fuera: en este punto
 * el usuario ya entregó su contraseña y no tiene sesión. Cerrar «sin querer»
 * lo dejaría en una pantalla de login que parece no haber pasado nada. Se sale
 * con «Cancelar», que vuelve al formulario de forma explícita.
 */
@Component({
  selector: 'app-mfa-modal',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mfa-modal.html',
  styleUrl: './mfa-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaModalComponent implements OnInit, AfterViewInit {
  readonly reto = input.required<RetoMfa>();

  readonly autenticado = output<Sesion>();
  readonly cancelado = output<void>();

  private readonly mfa = inject(MfaService);

  private readonly casillas = viewChild<ElementRef<HTMLDivElement>>('casillas');

  /** Un dígito por casilla; se juntan para enviar. */
  readonly digitos = signal<string[]>(Array(DIGITOS).fill(''));
  readonly codigo = computed(() => this.digitos().join(''));
  readonly completo = computed(() => this.codigo().length === DIGITOS);

  readonly cargando = signal(false);
  readonly error = signal('');

  /** Datos del enrolamiento; nulos mientras se piden o si el usuario ya está enrolado. */
  readonly otpauth = signal('');
  readonly claveManual = signal('');
  private readonly tokenInscripcion = signal('');
  readonly qrSvg = signal('');
  readonly verClaveManual = signal(false);

  /** Primera vez: hay que mostrar el QR antes de pedir el código. */
  readonly enrolando = computed(() => this.reto().inscripcion);

  ngOnInit(): void {
    if (this.enrolando()) void this.pedirQr();
  }

  /**
   * El foco en la primera casilla, cuando las casillas YA existen. En
   * `ngOnInit` la vista todavía no está montada y el foco se perdía: quien
   * llega aquí viene de teclear su contraseña y lo único que quiere es seguir
   * tecleando, sin buscar dónde hacer clic.
   */
  ngAfterViewInit(): void {
    this.enfocar(0);
  }

  constructor() {
    // El QR se dibuja cuando llega el URI, no antes: el <svg> se inserta como
    // HTML y el contenedor puede no existir todavía.
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
   * La librería del QR se carga SOLO aquí. Son unos 50 kB que no tienen por
   * qué viajar en el paquete inicial: la mayoría de las veces el usuario ya
   * está enrolado y nunca ve un QR.
   */
  private async dibujarQr(uri: string): Promise<void> {
    try {
      const qr = await import('qrcode');
      // SVG y no canvas: escala sin pixelarse, se imprime bien y hereda el
      // color del tema sin tener que repintar nada al cambiar de claro a oscuro.
      const svg = await qr.toString(uri, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0b1a26ff', light: '#ffffffff' },
      });
      this.qrSvg.set(svg);
    } catch {
      // Sin QR todavía se puede enrolar tecleando la clave manual.
      this.verClaveManual.set(true);
    }
  }

  /** Escribir en una casilla pasa a la siguiente; borrar, a la anterior. */
  alEscribir(i: number, ev: Event): void {
    const el = ev.target as HTMLInputElement;
    const valor = el.value.replace(/\D+/g, '');
    this.error.set('');

    // Pegar los seis de golpe es lo que hace medio mundo: se reparten.
    if (valor.length > 1) {
      const repartidos = valor.slice(0, DIGITOS).split('');
      this.digitos.update((d) => d.map((v, j) => repartidos[j - i] ?? (j < i ? v : '')));
      el.value = this.digitos()[i] ?? '';
      this.enfocar(Math.min(i + repartidos.length, DIGITOS - 1));
      if (this.completo()) void this.enviar();
      return;
    }

    this.digitos.update((d) => d.map((v, j) => (j === i ? valor : v)));
    el.value = valor;
    if (valor && i < DIGITOS - 1) this.enfocar(i + 1);
    if (this.completo()) void this.enviar();
  }

  alTeclear(i: number, ev: KeyboardEvent): void {
    const el = ev.target as HTMLInputElement;
    if (ev.key === 'Backspace' && !el.value && i > 0) {
      this.enfocar(i - 1);
    } else if (ev.key === 'ArrowLeft' && i > 0) {
      ev.preventDefault(); this.enfocar(i - 1);
    } else if (ev.key === 'ArrowRight' && i < DIGITOS - 1) {
      ev.preventDefault(); this.enfocar(i + 1);
    } else if (ev.key === 'Enter' && this.completo()) {
      void this.enviar();
    }
  }

  private enfocar(i: number): void {
    const campos = this.casillas()?.nativeElement.querySelectorAll('input');
    (campos?.[i] as HTMLInputElement | undefined)?.focus();
  }

  private limpiar(): void {
    this.digitos.set(Array(DIGITOS).fill(''));
    const campos = this.casillas()?.nativeElement.querySelectorAll('input');
    campos?.forEach((c) => ((c as HTMLInputElement).value = ''));
    this.enfocar(0);
  }

  async enviar(): Promise<void> {
    if (!this.completo() || this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      const sesion = this.enrolando()
        ? await this.mfa.confirmarInscripcion(this.reto().reto, this.tokenInscripcion(), this.codigo())
        : await this.mfa.verificar(this.reto().reto, this.codigo());
      this.autenticado.emit(sesion);
    } catch (e) {
      // El mensaje del servidor es el útil: dice si el código es incorrecto,
      // si ya se usó o cuántos minutos falta para salir del bloqueo.
      this.error.set((e as { error?: { message?: string } })?.error?.message
        ?? 'No fue posible verificar el código.');
      this.limpiar();
    } finally {
      this.cargando.set(false);
    }
  }

  async copiarClave(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(this.claveManual());
    } catch { /* si no se puede copiar, ahí está para leerla */ }
  }
}
