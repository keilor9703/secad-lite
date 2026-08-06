import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogosService } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { Agencia, CanalAtencion, CodigoCaso, PrioridadCaso, TipoAgencia } from '../../core/models';

/**
 * Catálogos operativos del secad: las agencias que atienden, sus canales de
 * despacho y la tipificación de casos. Es configuración de la operación, no de
 * la plataforma ni de las cuentas, por eso vive fuera de Administración.
 */
@Component({
  selector: 'app-catalogos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './catalogos.html',
  styleUrl: './catalogos.scss',
})
export class CatalogosComponent {
  private catalogos = inject(CatalogosService);
  private auth = inject(AuthService);

  readonly error = signal('');
  readonly agencias = signal<Agencia[]>([]);
  readonly canales = signal<CanalAtencion[]>([]);
  readonly codigos = signal<CodigoCaso[]>([]);

  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly tenantCtx = this.auth.tenantCtx;
  readonly puedeEditar = computed(() => this.auth.tienePermiso('catalogos.gestionar'));

  readonly tiposAgencia: TipoAgencia[] = ['policia', 'bomberos', 'salud', 'transito', 'gestion_riesgo', 'otra'];
  readonly prioridades: PrioridadCaso[] = ['alta', 'media', 'baja'];

  nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' as TipoAgencia };
  nuevoCanal: Record<string, { codigo: string; nombre: string }> = {};
  nuevoCodigo = { codigo: '', descripcion: '', prioridad: 'media' as PrioridadCaso, agenciaSugeridaId: '' };

  /** Búsqueda dentro del catálogo de códigos, que puede traer miles. */
  filtroCodigo = '';
  private readonly filtro = signal('');
  private readonly TOPE = 100;
  private readonly coincidencias = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    const todos = this.codigos();
    if (!q) return todos;
    return todos.filter((c) => c.codigo.toLowerCase().includes(q) || c.descripcion.toLowerCase().includes(q));
  });
  readonly codigosFiltrados = computed(() => this.coincidencias().slice(0, this.TOPE));
  readonly codigosCoincidentes = computed(() => this.coincidencias().length);

  constructor() {
    // Los catálogos son del tenant activo: si el superadmin cambia de instancia
    // desde la barra superior, se recargan solos.
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
    });
  }

  buscarCodigo(texto: string): void {
    this.filtroCodigo = texto;
    this.filtro.set(texto);
  }

  canalesDe(agenciaId: string): CanalAtencion[] {
    return this.canales().filter((c) => c.agenciaId === agenciaId);
  }

  nombreAgencia(id: string | null | undefined): string {
    return this.agencias().find((a) => a.id === id)?.nombre ?? '—';
  }

  private cargar(): void {
    this.catalogos.agencias().subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
    this.catalogos.codigos().subscribe({ next: (c) => this.codigos.set(c), error: () => {} });
  }

  // --- Agencias y canales -----------------------------------------------------

  crearAgencia(): void {
    this.error.set('');
    const { codigo, nombre, tipo } = this.nuevaAgencia;
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre de la agencia son obligatorios.'); return; }
    this.catalogos.crearAgencia({ codigo: codigo.trim(), nombre: nombre.trim(), tipo }).subscribe({
      next: (a) => { this.agencias.update((as) => [...as, a]); this.nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' }; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la agencia.'),
    });
  }

  alternarAgencia(a: Agencia): void {
    this.catalogos.actualizarAgencia(a.id, { activo: !a.activo }).subscribe({
      next: (act) => {
        this.agencias.update((as) => as.map((x) => (x.id === act.id ? act : x)));
        // Desactivar la agencia arrastra sus canales: se recargan para reflejarlo.
        if (!act.activo) this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar la agencia.'),
    });
  }

  crearCanal(agencia: Agencia): void {
    this.error.set('');
    const dato = this.nuevoCanal[agencia.id] ?? { codigo: '', nombre: '' };
    if (!dato.codigo.trim() || !dato.nombre.trim()) { this.error.set('Código y nombre del canal son obligatorios.'); return; }
    this.catalogos.crearCanal({ agenciaId: agencia.id, codigo: dato.codigo.trim(), nombre: dato.nombre.trim() }).subscribe({
      next: (c) => { this.canales.update((cs) => [...cs, c]); this.nuevoCanal[agencia.id] = { codigo: '', nombre: '' }; },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el canal.'),
    });
  }

  alternarCanal(c: CanalAtencion): void {
    this.catalogos.actualizarCanal(c.id, { activo: !c.activo }).subscribe({
      next: (act) => this.canales.update((cs) => cs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el canal.'),
    });
  }

  // --- Códigos de caso --------------------------------------------------------

  crearCodigo(): void {
    this.error.set('');
    const { codigo, descripcion, prioridad, agenciaSugeridaId } = this.nuevoCodigo;
    if (!codigo.trim() || !descripcion.trim()) { this.error.set('Código y descripción son obligatorios.'); return; }
    this.catalogos.crearCodigo({
      codigo: codigo.trim(), descripcion: descripcion.trim(), prioridad,
      agenciaSugeridaId: agenciaSugeridaId || null,
    }).subscribe({
      next: (c) => {
        this.codigos.update((cs) => [...cs, c]);
        this.nuevoCodigo = { codigo: '', descripcion: '', prioridad: 'media', agenciaSugeridaId: '' };
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el código de caso.'),
    });
  }

  alternarCodigo(c: CodigoCaso): void {
    this.catalogos.actualizarCodigo(c.id, { activo: !c.activo }).subscribe({
      next: (act) => this.codigos.update((cs) => cs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el código.'),
    });
  }
}
