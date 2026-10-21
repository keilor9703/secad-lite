import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { IconoComponent } from '../../shared/icono/icono';

/**
 * «Llamar» junto a un número.
 *
 * No llama desde el navegador: le pide a la central que timbre primero la
 * extensión del operador y, al descolgar, al ciudadano. Por eso funciona sin
 * softphone y sin micrófono — y por eso el texto dice lo que va a pasar, que
 * si no, el operador aprieta y no entiende por qué suena su propio teléfono.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUÁNDO NO SE DIBUJA
 *
 * El botón desaparece —no se deshabilita— si falta cualquiera de estas cuatro,
 * porque un botón que no puede funcionar es peor que ninguno:
 *
 *  - la instancia no contrató la planta telefónica;
 *  - el operador no tiene `pbx.usar`;
 *  - la planta de esa instancia **no sabe originar llamadas** (lo dice el
 *    proveedor, en sus capacidades) o está apagada;
 *  - lo que hay no es un número marcable — para los contactos de WhatsApp la
 *    central manda un identificador de sesión que parece un número y no lo es.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Component({
  selector: 'app-boton-llamar',
  standalone: true,
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <span class="llamar">
        <button type="button" class="btn btn--ghost mini" [disabled]="llamando()"
                [attr.aria-label]="'Llamar a ' + numero()" (click)="llamar()">
          <app-icono nombre="telefono" [tam]="14" />
          {{ llamando() ? 'Pidiendo…' : 'Llamar' }}
        </button>
        @if (aviso(); as a) {
          <small [class.error]="!ok()" [class.exito]="ok()" role="status">{{ a }}</small>
        }
      </span>
    }
  `,
  styles: [`
    .llamar { display: inline-flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .llamar small { max-width: 40ch; }
  `],
})
export class BotonLlamarComponent {
  /**
   * El número del ciudadano.
   *
   * Admite `undefined` además de `null` porque los campos opcionales del
   * modelo son `string | undefined` y los de un formulario, `string | null`:
   * un `input` que solo acepte uno de los dos obliga a poner `?? null` en cada
   * plantilla que lo use, y eso se olvida —se olvidó, y lo encontró la
   * compilación de producción, que es la única que revisa las plantillas—.
   */
  readonly numero = input<string | null | undefined>(null);
  /** El caso desde el que se llama, si lo hay: queda una nota. */
  readonly casoId = input<string | null | undefined>(null);

  private readonly pbx = inject(PbxService);
  private readonly auth = inject(AuthService);

  readonly llamando = signal(false);
  readonly aviso = signal('');
  readonly ok = signal(false);

  readonly visible = computed(() =>
    this.auth.tieneIntegracion('pbx')
    && this.auth.tienePermiso('pbx.usar')
    && this.pbx.puede('marcar')
    && this.tieneExtension()
    && PbxService.esNumeroMarcable(this.numero()));

  /**
   * ¿Este usuario tiene a dónde recibir el timbre?
   *
   * La planta timbra PRIMERO al operador y después al ciudadano, así que sin
   * extensión no hay llamada posible — ni con softphone, que necesita la misma
   * cuenta SIP. Un despachador sin extensión apretaba el botón y solo entonces
   * se enteraba, en mitad de una emergencia.
   *
   * Se le asigna en Administración → Usuarios. El backend sigue comprobándolo
   * por su cuenta: esto decide qué se dibuja, no quién puede llamar.
   */
  private readonly tieneExtension = computed(
    () => !!this.auth.sesion()?.extension?.trim(),
  );

  llamar(): void {
    const numero = this.numero();
    if (!numero || this.llamando()) return;
    this.llamando.set(true);
    this.aviso.set('');
    this.pbx.marcar(numero, this.casoId() ?? undefined).subscribe({
      next: (r) => {
        this.llamando.set(false);
        this.ok.set(r.ok);
        // El mensaje del servidor tal cual: dice a qué extensión va a timbrar,
        // o por qué no se pudo (sin saldo, credenciales, central caída).
        this.aviso.set(r.mensaje);
      },
      error: (e) => {
        this.llamando.set(false);
        this.ok.set(false);
        this.aviso.set(e?.error?.message ?? 'No fue posible pedir la llamada.');
      },
    });
  }
}
