import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, TemaToggleComponent, LogoComponent, ToastComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  usuario = '';
  contrasena = '';
  cargando = false;
  error = '';

  entrar(): void {
    this.error = '';
    if (!this.usuario.trim() || !this.contrasena) {
      this.error = 'Diligencie usuario y contraseña.';
      return;
    }
    this.cargando = true;
    this.auth.login(this.usuario.trim(), this.contrasena).subscribe({
      // Si venía de una página cuando expiró la sesión, se le devuelve allá;
      // si no, inicioGuard elige la página según su trabajo.
      next: () => {
        this.cargando = false;
        const volverA = this.route.snapshot.queryParamMap.get('volverA');
        this.router.navigateByUrl(volverA && volverA.startsWith('/') ? volverA : '/');
      },
      error: (e) => {
        this.cargando = false;
        this.error = e?.error?.message ?? 'No fue posible iniciar sesión.';
      },
    });
  }
}
