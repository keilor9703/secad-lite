import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';

import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { LogoComponent } from '../../shared/logo/logo';
import { ToastComponent } from '../../shared/toast/toast';
import { MfaModalComponent } from './mfa/mfa-modal';
import { CodigoCasillasComponent } from './mfa/codigo-casillas';
import { MfaService } from '../../core/mfa.service';
import { RetoMfa, esRetoMfa } from '../../core/mfa.service';
import { Sesion } from '../../core/models';

/**
 * Entrada a la consola. Solo hay una forma de identificarse, porque quien entra
 * aquí siempre es un funcionario del secad: operador, despachador, supervisor o
 * administrador.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TemaToggleComponent, LogoComponent, ToastComponent, MfaModalComponent, CodigoCasillasComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private mfa = inject(MfaService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly form = new FormGroup({
    usuario: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    contrasena: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly cargando = signal(false);
  readonly error = signal('');

  /**
   * Reto de doble factor devuelto por el login. Mientras esté puesto, la
   * ventana del segundo factor está abierta y el usuario NO tiene sesión.
   */
  readonly reto = signal<RetoMfa | null>(null);

  /**
   * Quien YA está enrolado no ve ninguna ventana: el formulario se extiende
   * hacia abajo y le pide el código ahí mismo. Teclear seis dígitos es parte
   * de entrar, no una interrupción — y tapar la pantalla para pedirlos la
   * convertía en un trámite aparte.
   */
  readonly pidiendoCodigo = computed(() => !!this.reto() && !this.reto()!.inscripcion);
  /** Solo la vinculación del primer dispositivo merece ventana propia. */
  readonly enrolando = computed(() => !!this.reto()?.inscripcion);

  readonly verificando = signal(false);
  /** Se desvanece la tarjeta antes de entrar, para que el salto no sea brusco. */
  readonly saliendo = signal(false);

  private readonly casillas = viewChild(CodigoCasillasComponent);

  entrar(): void {
    this.error.set('');
    if (this.form.invalid) {
      this.error.set('Diligencie usuario y contraseña.');
      this.form.markAllAsTouched();
      return;
    }
    const { usuario, contrasena } = this.form.getRawValue();
    this.cargando.set(true);
    this.auth.login(usuario.trim(), contrasena).subscribe({
      // Si venía de una página cuando expiró la sesión, se le devuelve allá;
      // si no, inicioGuard elige la página según su trabajo.
      next: (r) => {
        this.cargando.set(false);
        // Falta el segundo factor: la contraseña era correcta, pero todavía no
        // hay sesión. La ventana se encarga del resto.
        if (esRetoMfa(r)) { this.reto.set(r); return; }
        this.entrarAlSistema();
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible iniciar sesión.');
      },
    });
  }

  /** Código del usuario ya enrolado, desde el panel desplegable. */
  async verificar(codigo: string): Promise<void> {
    const reto = this.reto();
    if (!reto || this.verificando()) return;

    this.verificando.set(true);
    this.error.set('');
    try {
      this.alAutenticar(await this.mfa.verificar(reto.reto, codigo));
    } catch (e) {
      this.error.set((e as { error?: { message?: string } })?.error?.message
        ?? 'No fue posible verificar el código.');
      this.casillas()?.limpiar();
    } finally {
      this.verificando.set(false);
    }
  }

  /** El segundo factor quedó validado y el servidor entregó la sesión. */
  alAutenticar(s: Sesion): void {
    this.auth.establecerSesion(s);
    this.reto.set(null);
    this.entrarAlSistema();
  }

  /**
   * Cancelar vuelve al formulario con la contraseña BORRADA: el reto queda sin
   * uso y hay que volver a identificarse. Dejarla escrita en una estación
   * compartida sería regalarle el primer factor al siguiente que se siente.
   */
  alCancelar(): void {
    this.reto.set(null);
    this.form.controls.contrasena.reset('');
    this.error.set('Inicio de sesión cancelado.');
  }

  /**
   * Entra al sistema. Si venía de una página cuando expiró la sesión, se le
   * devuelve allá.
   *
   * Antes de navegar, la tarjeta se desvanece: sin eso el salto es un corte
   * seco de una pantalla a otra. Son 260 ms, el tiempo justo para que el ojo
   * registre el cambio sin que nadie sienta que espera. Quien pidió menos
   * movimiento en su sistema operativo entra directo, sin transición.
   */
  private entrarAlSistema(): void {
    const volverA = this.route.snapshot.queryParamMap.get('volverA');
    const destino = volverA && volverA.startsWith('/') ? volverA : '/';

    const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (sinMovimiento) { void this.router.navigateByUrl(destino); return; }

    this.saliendo.set(true);
    setTimeout(() => void this.router.navigateByUrl(destino), 260);
  }
}
