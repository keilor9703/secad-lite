import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { LogoComponent } from '../../shared/logo/logo';
import { ToastComponent } from '../../shared/toast/toast';

/**
 * Entrada a la consola. Solo hay una forma de identificarse, porque quien entra
 * aquí siempre es un funcionario del secad: operador, despachador, supervisor o
 * administrador. El acceso del ciudadano no vive en esta consola —si algún día
 * se abre un portal público de chat, será una aplicación aparte con su propia
 * puerta (el backend conserva el endpoint para eso).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TemaToggleComponent, LogoComponent, ToastComponent],
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
      next: () => {
        this.cargando.set(false);
        const volverA = this.route.snapshot.queryParamMap.get('volverA');
        this.router.navigateByUrl(volverA && volverA.startsWith('/') ? volverA : '/');
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.error?.message ?? 'No fue posible iniciar sesión.');
      },
    });
  }
}
