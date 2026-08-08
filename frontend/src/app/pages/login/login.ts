import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
      // A dónde entra cada quien lo decide inicioGuard, según su trabajo.
      next: () => { this.cargando = false; this.router.navigate(['/']); },
      error: (e) => {
        this.cargando = false;
        this.error = e?.error?.message ?? 'No fue posible iniciar sesión.';
      },
    });
  }
}
