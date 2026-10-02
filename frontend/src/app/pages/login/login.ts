import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { LogoComponent } from '../../shared/logo/logo';
import { ToastComponent } from '../../shared/toast/toast';
import { MfaModalComponent } from './mfa/mfa-modal';
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
  imports: [ReactiveFormsModule, TemaToggleComponent, LogoComponent, ToastComponent, MfaModalComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private auth = inject(AuthService);
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

  /** Si venía de una página cuando expiró la sesión, se le devuelve allá. */
  private entrarAlSistema(): void {
    const volverA = this.route.snapshot.queryParamMap.get('volverA');
    this.router.navigateByUrl(volverA && volverA.startsWith('/') ? volverA : '/');
  }
}
