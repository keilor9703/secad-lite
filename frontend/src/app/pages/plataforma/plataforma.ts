import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/admin.service';
import { EstadoSuscripcion, PlanTenant, Tenant, UsuarioAdmin } from '../../core/models';

/**
 * Supervisión de la plataforma: es la vista del dueño de FALCON CAD, no la del
 * municipio. Desde aquí se dan de alta las instancias, se gobierna su
 * suscripción (plan, vigencia, suspensión) y se habilitan las integraciones que
 * cada una tiene contratadas.
 */
@Component({
  selector: 'app-plataforma',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './plataforma.html',
  styleUrl: './plataforma.scss',
})
export class PlataformaComponent implements OnInit {
  private admin = inject(AdminService);

  readonly tenants = signal<Tenant[]>([]);
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly error = signal('');

  readonly planes: PlanTenant[] = ['basico', 'estandar', 'avanzado'];
  readonly estados: EstadoSuscripcion[] = ['prueba', 'activa', 'suspendida'];
  readonly integracionesPosibles = [
    { clave: 'pbx', nombre: 'Planta telefónica' },
    { clave: 'whatsapp', nombre: 'WhatsApp' },
    { clave: 'api', nombre: 'API entrante' },
  ];

  nuevoTenant = { codigo: '', nombre: '' };

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.admin.listarTenants().subscribe({
      next: (t) => this.tenants.set(t),
      error: () => this.error.set('No fue posible cargar las instancias.'),
    });
    this.admin.listarUsuarios().subscribe({ next: (u) => this.usuarios.set(u), error: () => {} });
  }

  /** Cuántas cuentas tiene cada instancia, para dimensionarla de un vistazo. */
  usuariosDe(codigo: string): number {
    return this.usuarios().filter((u) => u.tenant === codigo).length;
  }

  /** Días que faltan para el vencimiento; negativo si ya venció. */
  diasRestantes(t: Tenant): number | null {
    if (!t.vence) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.round((new Date(t.vence + 'T00:00:00').getTime() - hoy.getTime()) / 864e5);
  }

  /** Estado que se muestra: refleja bloqueo, vencimiento y suspensión. */
  situacion(t: Tenant): { texto: string; clase: string } {
    if (!t.activo) return { texto: 'Bloqueada', clase: 'mala' };
    if (t.suscripcion === 'suspendida') return { texto: 'Suspendida', clase: 'mala' };
    const dias = this.diasRestantes(t);
    if (dias !== null && dias < 0) return { texto: 'Vencida', clase: 'mala' };
    if (dias !== null && dias <= 15) return { texto: `Vence en ${dias} d`, clase: 'aviso' };
    return { texto: t.suscripcion === 'prueba' ? 'En prueba' : 'Al día', clase: 'bien' };
  }

  crearTenant(): void {
    this.error.set('');
    const { codigo, nombre } = this.nuevoTenant;
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre son obligatorios.'); return; }
    this.admin.crearTenant(codigo.trim(), nombre.trim()).subscribe({
      next: (t) => { this.tenants.update((ts) => [...ts, t]); this.nuevoTenant = { codigo: '', nombre: '' }; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la instancia.'),
    });
  }

  actualizar(t: Tenant, cambios: Partial<Tenant>): void {
    this.error.set('');
    this.admin.actualizarTenant(t.id, cambios).subscribe({
      next: (act) => this.tenants.update((ts) => ts.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar la instancia.'),
    });
  }

  /** Suspender exige un motivo: es lo que se le muestra a quien intente entrar. */
  suspender(t: Tenant): void {
    const motivo = window.prompt('Motivo de la suspensión (lo verá el municipio al intentar entrar):', t.motivoBloqueo ?? '');
    if (!motivo?.trim()) return;
    this.actualizar(t, { suscripcion: 'suspendida', motivoBloqueo: motivo.trim() });
  }

  reactivar(t: Tenant): void {
    this.actualizar(t, { suscripcion: 'activa', activo: true, motivoBloqueo: null });
  }

  tieneIntegracion(t: Tenant, clave: string): boolean {
    return (t.integraciones ?? []).includes(clave);
  }

  alternarIntegracion(t: Tenant, clave: string): void {
    const actuales = t.integraciones ?? [];
    const integraciones = actuales.includes(clave)
      ? actuales.filter((i) => i !== clave)
      : [...actuales, clave];
    this.actualizar(t, { integraciones });
  }
}
