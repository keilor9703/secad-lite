import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, CrearUsuario } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { PbxConfig, Rol, Tenant, UsuarioAdmin } from '../../core/models';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent implements OnInit {
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private pbx = inject(PbxService);

  readonly esSuperadmin = this.auth.esSuperadmin;

  readonly tenants = signal<Tenant[]>([]);
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly error = signal('');

  readonly rolesDisponibles: Rol[] = ['admin', 'supervisor', 'operador'];

  // Integración PBX (planta telefónica)
  readonly pbxConfig = signal<PbxConfig | null>(null);
  readonly mostrarKey = signal(false);
  copiado = '';

  // Formularios
  nuevoTenant = { codigo: '', nombre: '' };
  nuevoUsuario: CrearUsuario = this.usuarioVacio();

  ngOnInit(): void {
    this.cargarUsuarios();
    if (this.esSuperadmin()) this.cargarTenants();
    else this.cargarPbx();
  }

  private cargarPbx(): void {
    this.pbx.config().subscribe({ next: (c) => this.pbxConfig.set(c), error: () => {} });
  }

  get webhookUrl(): string {
    const c = this.pbxConfig();
    return c ? this.pbx.webhookUrl(c.webhookPath) : '';
  }

  rotarPbx(): void {
    if (!window.confirm('Al rotar la clave, la PBX dejará de funcionar hasta actualizarla. ¿Continuar?')) return;
    this.pbx.rotarKey().subscribe({
      next: (c) => { this.pbxConfig.set(c); this.mostrarKey.set(true); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible rotar la clave.'),
    });
  }

  copiar(texto: string, que: string): void {
    navigator.clipboard?.writeText(texto).then(() => {
      this.copiado = que;
      setTimeout(() => { if (this.copiado === que) this.copiado = ''; }, 1500);
    }).catch(() => {});
  }

  private cargarTenants(): void {
    this.admin.listarTenants().subscribe({
      next: (t) => this.tenants.set(t),
      error: () => this.error.set('No fue posible cargar los tenants.'),
    });
  }

  private cargarUsuarios(): void {
    this.admin.listarUsuarios().subscribe({
      next: (u) => this.usuarios.set(u),
      error: () => this.error.set('No fue posible cargar los usuarios.'),
    });
  }

  crearTenant(): void {
    this.error.set('');
    const { codigo, nombre } = this.nuevoTenant;
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre del tenant son obligatorios.'); return; }
    this.admin.crearTenant(codigo.trim(), nombre.trim()).subscribe({
      next: (t) => { this.tenants.update((ts) => [...ts, t]); this.nuevoTenant = { codigo: '', nombre: '' }; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el tenant.'),
    });
  }

  crearUsuario(): void {
    this.error.set('');
    const dto = { ...this.nuevoUsuario, username: this.nuevoUsuario.username.trim() };
    if (!dto.username || !dto.nombre.trim() || !dto.contrasena) {
      this.error.set('Usuario, nombre y contraseña son obligatorios.'); return;
    }
    if (this.esSuperadmin() && !dto.tenant) { this.error.set('Seleccione el tenant del usuario.'); return; }
    this.admin.crearUsuario(dto).subscribe({
      next: (u) => { this.usuarios.update((us) => [...us, u]); this.nuevoUsuario = this.usuarioVacio(); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el usuario.'),
    });
  }

  toggleActivo(u: UsuarioAdmin): void {
    this.admin.cambiarActivo(u.id, !u.activo).subscribe({
      next: (act) => this.usuarios.update((us) => us.map((x) => (x.id === act.id ? act : x))),
      error: () => this.error.set('No fue posible actualizar el usuario.'),
    });
  }

  private usuarioVacio(): CrearUsuario {
    return { username: '', nombre: '', contrasena: '', rol: 'operador', tenant: '' };
  }
}
