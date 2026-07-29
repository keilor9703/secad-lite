import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MfaLoginChallenge, PoliciaMfaFlowComponent } from '@policia/mfa';
import { AuthService } from '../../core/auth.service';

type Modo = 'institucional' | 'civil';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, PoliciaMfaFlowComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  modo: Modo = 'institucional';
  usuario = '';
  contrasena = '';
  cargando = false;
  error = '';

  /** Reto 2FA (solo ruta institucional). En el mock no se dispara; queda cableado. */
  mfaChallenge: MfaLoginChallenge | null = null;

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
      this.modo === 'institucional'
        ? this.auth.loginInstitucional(this.usuario.trim(), this.contrasena)
        : this.auth.loginCivil(this.usuario.trim(), this.contrasena);

    flujo.subscribe({
      next: (resp: any) => {
        this.cargando = false;
        // Ruta institucional con 2FA: delega en el componente de @policia/mfa.
        if (resp?.requiresMfa) {
          this.mfaChallenge = resp as MfaLoginChallenge;
          return;
        }
        this.router.navigate([this.modo === 'civil' ? '/chat' : '/recepcion']);
      },
      error: (e) => {
        this.cargando = false;
        this.error = e?.error?.message ?? 'No fue posible iniciar sesión.';
      },
    });
  }

  onMfaOk(_token: string): void {
    // En producción: establecer la sesión a partir del token y navegar.
    this.mfaChallenge = null;
    this.router.navigate(['/recepcion']);
  }
}
