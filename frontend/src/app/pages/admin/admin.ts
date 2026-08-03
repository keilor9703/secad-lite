import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService, CrearUsuario } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { WhatsappService } from '../../core/whatsapp.service';
import { RolesService } from '../../core/roles.service';
import { EntidadesService } from '../../core/entidades.service';
import { EntidadExterna, PbxConfig, PermisoDef, RolTenant, Tenant, UsuarioAdmin, WhatsappConfig } from '../../core/models';

interface GrupoPermisos {
  grupo: string;
  permisos: PermisoDef[];
}

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
  private wa = inject(WhatsappService);
  private rolesSvc = inject(RolesService);
  private entidadesSvc = inject(EntidadesService);

  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly gestionaRoles = this.auth.gestionaRoles;
  readonly gestionaEntidades = this.auth.tienePermiso('entidades.gestionar');

  readonly tenants = signal<Tenant[]>([]);
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly error = signal('');

  // Roles y permisos (RBAC dinámico)
  readonly catalogo = signal<PermisoDef[]>([]);
  readonly roles = signal<RolTenant[]>([]);
  readonly grupos = computed<GrupoPermisos[]>(() => {
    const out: GrupoPermisos[] = [];
    for (const p of this.catalogo()) {
      const g = out.find((x) => x.grupo === p.grupo);
      if (g) g.permisos.push(p);
      else out.push({ grupo: p.grupo, permisos: [p] });
    }
    return out;
  });
  private readonly sucios = signal<Set<string>>(new Set());
  readonly haySucios = computed(() => this.sucios().size > 0);
  nuevoRol = '';
  guardandoRoles = false;
  readonly rolesOk = signal(false);

  /** Roles asignables en el formulario de usuario (códigos del tenant). */
  readonly rolesDisponibles = computed<string[]>(() => {
    const r = this.roles();
    if (r.length) return r.map((x) => x.codigo);
    return ['admin', 'supervisor', 'operador'];
  });

  // Entidades externas (API entrante)
  readonly entidades = signal<EntidadExterna[]>([]);
  readonly keyVisible = signal<string | null>(null);
  nuevaEntidad = { nombre: '', agencia: '' };

  // Integración PBX (planta telefónica)
  readonly pbxConfig = signal<PbxConfig | null>(null);
  readonly mostrarKey = signal(false);
  copiado = '';

  // Integración WhatsApp
  readonly waConfig = signal<WhatsappConfig | null>(null);
  waPhoneNumberId = '';
  waAccessToken = '';
  waGuardando = false;
  readonly waOk = signal(false);

  // Formularios
  nuevoTenant = { codigo: '', nombre: '' };
  nuevoUsuario: CrearUsuario = this.usuarioVacio();

  ngOnInit(): void {
    this.cargarUsuarios();
    if (this.esSuperadmin()) this.cargarTenants();
    else {
      this.cargarPbx();
      this.cargarWa();
      if (this.gestionaRoles()) this.cargarRoles();
      if (this.gestionaEntidades) this.cargarEntidades();
    }
  }

  // --- Roles y permisos -------------------------------------------------------
  private cargarRoles(): void {
    this.rolesSvc.catalogo().subscribe({ next: (c) => this.catalogo.set(c), error: () => {} });
    this.rolesSvc.listar().subscribe({ next: (r) => this.roles.set(r), error: () => {} });
  }

  tiene(rol: RolTenant, clave: string): boolean {
    return rol.permisos?.includes(clave) ?? false;
  }

  toggle(rol: RolTenant, clave: string): void {
    const tiene = this.tiene(rol, clave);
    const permisos = tiene ? rol.permisos.filter((p) => p !== clave) : [...(rol.permisos ?? []), clave];
    this.roles.update((rs) => rs.map((r) => (r.id === rol.id ? { ...r, permisos } : r)));
    this.sucios.update((s) => new Set(s).add(rol.id));
    this.rolesOk.set(false);
  }

  guardarRoles(): void {
    const pendientes = this.roles().filter((r) => this.sucios().has(r.id));
    if (!pendientes.length) return;
    this.guardandoRoles = true;
    this.error.set('');
    let restantes = pendientes.length;
    for (const rol of pendientes) {
      this.rolesSvc.actualizar(rol.id, { permisos: rol.permisos }).subscribe({
        next: (act) => {
          this.roles.update((rs) => rs.map((r) => (r.id === act.id ? act : r)));
          this.sucios.update((s) => { const n = new Set(s); n.delete(act.id); return n; });
          if (--restantes === 0) { this.guardandoRoles = false; this.rolesOk.set(true); }
        },
        error: (e) => {
          this.guardandoRoles = false;
          this.error.set(e?.error?.message ?? 'No fue posible guardar los permisos.');
        },
      });
    }
  }

  crearRol(): void {
    const nombre = this.nuevoRol.trim();
    if (!nombre) return;
    this.error.set('');
    this.rolesSvc.crear(nombre, []).subscribe({
      next: (r) => { this.roles.update((rs) => [...rs, r]); this.nuevoRol = ''; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el rol.'),
    });
  }

  eliminarRol(rol: RolTenant): void {
    if (!window.confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return;
    this.error.set('');
    this.rolesSvc.eliminar(rol.id).subscribe({
      next: () => this.roles.update((rs) => rs.filter((r) => r.id !== rol.id)),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible eliminar el rol.'),
    });
  }

  // --- Entidades externas (API entrante) -------------------------------------
  get integracionUrl(): string {
    return this.entidadesSvc.endpointUrl();
  }

  private cargarEntidades(): void {
    this.entidadesSvc.listar().subscribe({ next: (e) => this.entidades.set(e), error: () => {} });
  }

  crearEntidad(): void {
    const nombre = this.nuevaEntidad.nombre.trim();
    if (!nombre) return;
    this.error.set('');
    this.entidadesSvc.crear(nombre, this.nuevaEntidad.agencia.trim() || undefined).subscribe({
      next: (e) => {
        this.entidades.update((es) => [...es, e]);
        this.nuevaEntidad = { nombre: '', agencia: '' };
        this.keyVisible.set(e.id);
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la entidad.'),
    });
  }

  toggleEntidad(e: EntidadExterna): void {
    this.entidadesSvc.actualizar(e.id, { activa: !e.activa }).subscribe({
      next: (act) => this.entidades.update((es) => es.map((x) => (x.id === act.id ? act : x))),
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible actualizar la entidad.'),
    });
  }

  rotarEntidad(e: EntidadExterna): void {
    if (!window.confirm(`Al rotar la clave, "${e.nombre}" dejará de poder radicar casos hasta actualizarla. ¿Continuar?`)) return;
    this.entidadesSvc.rotar(e.id).subscribe({
      next: (act) => {
        this.entidades.update((es) => es.map((x) => (x.id === act.id ? act : x)));
        this.keyVisible.set(act.id);
      },
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible rotar la clave.'),
    });
  }

  // --- Integraciones ----------------------------------------------------------
  private cargarPbx(): void {
    this.pbx.config().subscribe({ next: (c) => this.pbxConfig.set(c), error: () => {} });
  }

  private cargarWa(): void {
    this.wa.config().subscribe({
      next: (c) => { this.waConfig.set(c); this.waPhoneNumberId = c.phoneNumberId ?? ''; },
      error: () => {},
    });
  }

  get waWebhookUrl(): string {
    const c = this.waConfig();
    return c ? this.wa.webhookUrl(c.webhookPath) : '';
  }

  guardarWa(): void {
    this.waGuardando = true;
    this.waOk.set(false);
    this.error.set('');
    this.wa.guardarConfig(this.waPhoneNumberId.trim(), this.waAccessToken.trim() || undefined).subscribe({
      next: (c) => { this.waConfig.set(c); this.waAccessToken = ''; this.waGuardando = false; this.waOk.set(true); },
      error: (e) => { this.waGuardando = false; this.error.set(e?.error?.message ?? 'No fue posible guardar la configuración de WhatsApp.'); },
    });
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

  // --- Tenants y usuarios -----------------------------------------------------
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

  cambiarRolUsuario(u: UsuarioAdmin, rol: string): void {
    if (!rol || rol === u.rol) return;
    this.admin.cambiarRol(u.id, rol).subscribe({
      next: (act) => this.usuarios.update((us) => us.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible cambiar el rol.'),
    });
  }

  private usuarioVacio(): CrearUsuario {
    return { username: '', nombre: '', contrasena: '', rol: 'operador', tenant: '' };
  }
}
