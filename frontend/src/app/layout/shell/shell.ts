import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class ShellComponent implements OnInit {
  private auth = inject(AuthService);
  private pbx = inject(PbxService);
  private router = inject(Router);

  readonly sesion = this.auth.sesion;
  readonly esAdmin = this.auth.esAdmin;
  readonly esSuperadmin = this.auth.esSuperadmin;
  /** Nº de llamadas timbrando (indicador global de la planta telefónica). */
  readonly sonando = this.pbx.sonando;

  ngOnInit(): void {
    // Los funcionarios de un tenant escuchan la cola de llamadas en vivo.
    const s = this.sesion();
    if (s?.tipo === 'institucional' && !this.esSuperadmin()) this.pbx.conectar();
  }

  salir(): void {
    this.pbx.desconectar();
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
