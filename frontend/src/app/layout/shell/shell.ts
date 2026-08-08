import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AdminService } from '../../core/admin.service';
import { PbxService } from '../../core/pbx.service';
import { Tenant } from '../../core/models';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../shared/toast/toast.service';
import { TemaToggleComponent } from '../../shared/tema-toggle/tema-toggle';
import { LogoComponent } from '../../shared/logo/logo';
import { ToastComponent } from '../../shared/toast/toast';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, TemaToggleComponent, LogoComponent, ToastComponent],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class ShellComponent implements OnInit {
  private auth = inject(AuthService);
  private admin = inject(AdminService);
  private pbx = inject(PbxService);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly sesion = this.auth.sesion;
  readonly esAdmin = this.auth.esAdmin;
  // Cada módulo se muestra solo si el rol tiene el permiso que lo gobierna.
  // ¡Ojo! No usar 'casos.ver' aquí: lo comparten Recepción, Consulta y
  // Catálogos (todos lo necesitan para leer su propia bandeja/catálogo), así
  // que un rol con solo Recepción vería también la pestaña Despacho. El
  // permiso propio y exclusivo del módulo Despacho es 'despacho.ver'.
  readonly puedeVerDespacho = computed(() => this.auth.tienePermiso('despacho.ver'));
  readonly puedeRecepcionar = computed(() => this.auth.tienePermiso('casos.crear'));
  /** La consulta histórica es de quien supervisa; el resto trabaja en su cola. */
  readonly puedeConsultar = computed(() => this.auth.tienePermiso('casos.ver_todos'));
  readonly puedeVerLlamadas = computed(() => this.auth.tienePermiso('pbx.usar'));
  readonly puedeVerRecursos = computed(() => this.auth.tienePermiso('recursos.ver'));
  readonly puedeVerPanel = computed(() => this.auth.tienePermiso('metricas.ver'));
  readonly puedeVerCatalogos = computed(() => this.auth.tienePermiso('catalogos.gestionar'));
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
    // Los permisos del token pueden estar desactualizados: se piden los vigentes.
    this.auth.refrescarPerfil();
    const s = this.sesion();
    if (s?.tipo !== 'institucional') return;
    if (!this.esSuperadmin()) {
      // Sin pbx.usar no se consulta la planta: evita un 403 en cada carga.
      if (this.puedeVerLlamadas()) this.pbx.conectar();
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
    // Cada página se recarga sola al cambiar el tenant activo; solo el detalle
    // de un caso queda huérfano (su id es de la otra instancia), así que desde
    // ahí se vuelve a la bandeja.
    if (/^\/recepcion\/.+/.test(this.router.url)) this.router.navigateByUrl('/recepcion');
  }

  // --- Cambiar MI contraseña (autoservicio) --------------------------------
  readonly cambioClaveAbierto = signal(false);
  claveActual = '';
  claveNueva = '';
  claveConfirma = '';
  readonly guardandoClave = signal(false);

  abrirCambioClave(): void {
    this.claveActual = this.claveNueva = this.claveConfirma = '';
    this.cambioClaveAbierto.set(true);
  }

  guardarClave(): void {
    if (!this.claveActual || !this.claveNueva) {
      this.toast.advertencia('Diligencie la contraseña actual y la nueva.');
      return;
    }
    if (this.claveNueva !== this.claveConfirma) {
      this.toast.advertencia('La confirmación no coincide con la contraseña nueva.');
      return;
    }
    this.guardandoClave.set(true);
    this.auth.cambiarContrasena(this.claveActual, this.claveNueva).subscribe({
      next: () => {
        this.guardandoClave.set(false);
        this.cambioClaveAbierto.set(false);
        this.toast.exito('Contraseña actualizada.');
      },
      // El toast global ya anuncia el motivo (actual incorrecta, muy corta…).
      error: () => this.guardandoClave.set(false),
    });
  }

  salir(): void {
    this.pbx.desconectar();
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
