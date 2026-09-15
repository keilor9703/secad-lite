import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService } from '../../core/admin.service';
import { EstadoSuscripcion, PlanTenant, Tenant } from '../../core/models';
import { SelectorMunicipioComponent } from '../../shared/selector-municipio/selector-municipio';
import { SelectorComponent } from '../../shared/selector/selector';
import { OpcionComponent } from '../../shared/selector/opcion';
import { FechaComponent } from '../../shared/fecha/fecha';

/**
 * Supervisión de la plataforma: es la vista del dueño de FALCON CAD, no la del
 * municipio. Desde aquí se dan de alta las instancias, se gobierna su
 * suscripción (plan, vigencia, suspensión) y se habilitan las integraciones que
 * cada una tiene contratadas.
 */
@Component({
  selector: 'app-plataforma',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, SelectorMunicipioComponent, SelectorComponent, OpcionComponent, FechaComponent],
  templateUrl: './plataforma.html',
  styleUrl: './plataforma.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlataformaComponent implements OnInit {
  private admin = inject(AdminService);

  readonly tenants = signal<Tenant[]>([]);
  readonly error = signal('');

  /** Cuentas de todas las instancias — cada tenant ya trae su propio conteo (GET /tenants). */
  readonly totalCuentas = computed(() => this.tenants().reduce((s, t) => s + (t.totalUsuarios ?? 0), 0));

  // --- Búsqueda y filtros -----------------------------------------------
  readonly filtroTexto = signal('');
  readonly filtroDepartamento = signal<string | null>(null);
  readonly filtroSubregion = signal<string | null>(null);

  /** Departamentos con al menos una instancia, para el filtro. */
  readonly departamentosDisponibles = computed(() => {
    const s = new Set(this.tenants().map((t) => t.departamento).filter((d): d is string => !!d));
    return [...s].sort((a, b) => a.localeCompare(b));
  });
  /** Subregiones del departamento elegido (todas, si no hay uno elegido). */
  readonly subregionesDisponibles = computed(() => {
    const depto = this.filtroDepartamento();
    const base = depto ? this.tenants().filter((t) => t.departamento === depto) : this.tenants();
    const s = new Set(base.map((t) => t.subregion).filter((x): x is string => !!x));
    return [...s].sort((a, b) => a.localeCompare(b));
  });

  /** Minúsculas y sin acentos, para buscar como habla la gente. */
  private normalizar(t: string): string {
    return (t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  readonly tenantsFiltrados = computed(() => {
    const q = this.normalizar(this.filtroTexto().trim());
    const depto = this.filtroDepartamento();
    const subregion = this.filtroSubregion();
    return this.tenants().filter((t) => {
      if (depto && t.departamento !== depto) return false;
      if (subregion && t.subregion !== subregion) return false;
      if (!q) return true;
      return this.normalizar(t.codigo).includes(q)
        || this.normalizar(t.nombre).includes(q)
        || this.normalizar(t.codigoDane ?? '').includes(q);
    });
  });

  limpiarFiltros(): void {
    this.filtroTexto.set('');
    this.filtroDepartamento.set(null);
    this.filtroSubregion.set(null);
  }

  /** Al cambiar de departamento, una subregión de otro departamento ya no aplica. */
  cambiarFiltroDepartamento(depto: string | null): void {
    this.filtroDepartamento.set(depto);
    this.filtroSubregion.set(null);
  }

  readonly planes: PlanTenant[] = ['basico', 'estandar', 'avanzado'];
  readonly estados: EstadoSuscripcion[] = ['prueba', 'activa', 'suspendida'];
  readonly integracionesPosibles = [
    { clave: 'pbx', nombre: 'Planta telefónica' },
    { clave: 'whatsapp', nombre: 'WhatsApp' },
    { clave: 'api', nombre: 'API entrante' },
    { clave: 'cti', nombre: 'CTI / YACO (barra embebida)' },
  ];

  readonly nuevoTenantForm = new FormGroup({
    codigo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    /** Código DANE del municipio, elegido en <app-selector-municipio>; departamento/subregión se derivan de él. */
    codigoDane: new FormControl<string | null>(null),
  });

  /** data URL máximo ~180KB (ver LOGO_MAX_CHARS del backend); avisa antes de subir algo que el servidor rechazará. */
  private readonly LOGO_MAX_BYTES = 180_000;
  readonly subiendoLogo = signal<string | null>(null);

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
    this.admin.listarTenants().subscribe({
      next: (t) => this.tenants.set(t),
      error: () => this.error.set('No fue posible cargar las instancias.'),
    });
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
    if (this.nuevoTenantForm.invalid) { this.error.set('Código y nombre son obligatorios.'); return; }
    const { codigo, nombre, codigoDane } = this.nuevoTenantForm.getRawValue();
    this.admin.crearTenant({
      codigo: codigo.trim(), nombre: nombre.trim(), codigoDane: codigoDane?.trim() || undefined,
    }).subscribe({
      next: (t) => {
        this.tenants.update((ts) => [...ts, t]);
        this.nuevoTenantForm.reset({ codigo: '', nombre: '', codigoDane: null });
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la instancia.'),
    });
  }

  /**
   * Municipio elegido desde <app-selector-municipio> para una instancia ya
   * creada. Ese control emite `null` en cuanto se elige el departamento —
   * antes de que haya municipio —, porque su valor ES el código DANE del
   * municipio y todavía no hay uno. Si se guardara ese null intermedio, el
   * PATCH volvería con codigoDane/departamento/municipio en null, el
   * [ngModel] se lo devolvería al selector y este se limpiaría solo antes
   * de que la persona alcanzara a elegir el municipio. Por eso solo se
   * persiste cuando ya hay un municipio real elegido.
   */
  cambiarUbicacion(t: Tenant, codigoDane: string | null): void {
    if (!codigoDane) return;
    this.actualizar(t, { codigoDane });
  }

  /** Sube la bandera/logo del tenant: se codifica en el navegador y se guarda como data URL. */
  subirLogo(t: Tenant, input: HTMLInputElement): void {
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!archivo.type.startsWith('image/')) { this.error.set('El archivo debe ser una imagen.'); return; }
    if (archivo.size > this.LOGO_MAX_BYTES) {
      this.error.set(`La imagen pesa demasiado (máx. ${Math.round(this.LOGO_MAX_BYTES / 1024)}KB) — es solo un ícono pequeño, use una versión liviana.`);
      return;
    }
    this.error.set('');
    this.subiendoLogo.set(t.id);
    const lector = new FileReader();
    lector.onload = () => {
      this.actualizar(t, { logoDataUrl: lector.result as string });
      this.subiendoLogo.set(null);
    };
    lector.onerror = () => { this.error.set('No fue posible leer la imagen.'); this.subiendoLogo.set(null); };
    lector.readAsDataURL(archivo);
  }

  quitarLogo(t: Tenant): void {
    this.actualizar(t, { logoDataUrl: null });
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
