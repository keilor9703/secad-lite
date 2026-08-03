import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AdminService } from '../../core/admin.service';
import { PbxService } from '../../core/pbx.service';
import { Tenant } from '../../core/models';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class ShellComponent implements OnInit {
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private pbx = inject(PbxService);
  private router = inject(Router);

  readonly sesion = this.auth.sesion;
  readonly esAdmin = this.auth.esAdmin;
  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly tenantCtx = this.auth.tenantCtx;
  /** Instancias disponibles para el selector del superadmin. */
  readonly tenants = signal<Tenant[]>([]);
  /** Nº de llamadas timbrando (indicador global de la planta telefónica). */
  readonly sonando = this.pbx.sonando;

  /**
   * Los módulos operativos trabajan siempre dentro de un tenant: el funcionario
   * usa el suyo y el superadmin, el que tenga en gestión. Sin tenant no hay nada
   * que mostrar, así que se ocultan hasta que elija uno.
   */
  readonly operativoVisible = computed(() => !this.esSuperadmin() || !!this.tenantCtx());

  ngOnInit(): void {
    const s = this.sesion();
    if (s?.tipo !== 'institucional') return;
    if (!this.esSuperadmin()) {
      this.pbx.conectar();
      return;
    }
    this.admin.listarTenants().subscribe({
      next: (ts) => {
        this.tenants.set(ts);
        // Arranca sobre la primera instancia para no dejar la sesión sin contexto.
        if (!this.tenantCtx() && ts.length) this.cambiarTenant(ts[0].codigo, false);
        else if (this.tenantCtx()) this.pbx.conectar();
      },
      error: () => {},
    });
  }

  /** Cambia el tenant en gestión: reabre la cola en vivo y recarga la vista. */
  cambiarTenant(codigo: string, recargarVista = true): void {
    if (!codigo || codigo === this.tenantCtx()) return;
    this.auth.setTenantCtx(codigo);
    this.pbx.reconectar();
    if (!recargarVista) return;
    // Rehace la ruta actual para que la página vuelva a pedir sus datos.
    const url = this.router.url;
    this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
  }

  salir(): void {
    this.pbx.desconectar();
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
