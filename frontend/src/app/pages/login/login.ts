import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Sesion } from '../../core/models';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { LogoComponent } from '../../shared/logo/logo';

type Modo = 'usuario' | 'ciudadano';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, TemaToggleComponent, LogoComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  modo: Modo = 'usuario';
  usuario = '';
  contrasena = '';
  cargando = false;
  error = '';

  setModo(m: Modo): void {
    this.modo = m;
    this.error = '';
  }

  entrar(): void {
    this.error = '';
    if (!this.usuario.trim() || !this.contrasena) {
      this.error = 'Diligencie usuario y contraseña.';
      return;
    }
    this.cargando = true;
    const flujo =
      this.modo === 'usuario'
        ? this.auth.login(this.usuario.trim(), this.contrasena)
        : this.auth.loginCivil(this.usuario.trim(), this.contrasena);

    flujo.subscribe({
      next: (s) => { this.cargando = false; this.navegar(s); },
      error: (e) => {
        this.cargando = false;
        this.error = e?.error?.message ?? 'No fue posible iniciar sesión.';
      },
    });
  }

  private navegar(s: Sesion): void {
    // A dónde entra cada quien lo decide inicioGuard, según su trabajo.
    this.router.navigate(['/']);
  }
}
