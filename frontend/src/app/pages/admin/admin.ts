import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, CrearUsuario } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { Rol, Tenant, UsuarioAdmin } from '../../core/models';

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

  readonly esSuperadmin = this.auth.esSuperadmin;

  readonly tenants = signal<Tenant[]>([]);
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly error = signal('');

  readonly rolesDisponibles: Rol[] = ['admin', 'supervisor', 'operador'];

  // Formularios
  nuevoTenant = { codigo: '', nombre: '' };
  nuevoUsuario: CrearUsuario = this.usuarioVacio();

  ngOnInit(): void {
    this.cargarUsuarios();
    if (this.esSuperadmin()) this.cargarTenants();
  }

  private cargarTenants(): void {
    this.admin.listarTenants().subscribe({
      next: (t) => this.tenants.set(t),
      error: () => this.error.set('No fue posible cargar los secads.'),
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
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre del secad son obligatorios.'); return; }
    this.admin.crearTenant(codigo.trim(), nombre.trim()).subscribe({
      next: (t) => { this.tenants.update((ts) => [...ts, t]); this.nuevoTenant = { codigo: '', nombre: '' }; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el secad.'),
    });
  }

  crearUsuario(): void {
    this.error.set('');
    const dto = { ...this.nuevoUsuario, username: this.nuevoUsuario.username.trim() };
    if (!dto.username || !dto.nombre.trim() || !dto.contrasena) {
      this.error.set('Usuario, nombre y contraseña son obligatorios.'); return;
    }
    if (this.esSuperadmin() && !dto.tenant) { this.error.set('Seleccione el secad del usuario.'); return; }
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
