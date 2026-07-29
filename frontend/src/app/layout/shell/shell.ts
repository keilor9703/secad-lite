import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class ShellComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly sesion = this.auth.sesion;
  readonly esAdmin = this.auth.esAdmin;
  readonly esSuperadmin = this.auth.esSuperadmin;

  salir(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
