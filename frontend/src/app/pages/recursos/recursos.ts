import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrearRecurso, DespachoService } from '../../core/despacho.service';
import { AuthService } from '../../core/auth.service';
import { CatalogosService } from '../../core/catalogos.service';
import { Agencia, EstadoRecurso, Recurso, TipoRecurso } from '../../core/models';

/** Lo editable de un recurso mientras está abierto en la fila. */
interface Edicion {
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  agenciaId: string | null;
}

/**
 * Gestión de la flota: alta, edición, baja y disponibilidad. La agencia sale
 * del catálogo operativo —no se escribe a mano—, para que la flota y los casos
 * hablen de las mismas entidades y el despacho por agencia cuadre.
 */
@Component({
  selector: 'app-recursos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recursos.html',
  styleUrl: './recursos.scss',
})
export class RecursosComponent {
  private despacho = inject(DespachoService);
  private auth = inject(AuthService);
  private catalogos = inject(CatalogosService);

  /** Supervisor/admin pueden gestionar la flota. */
  readonly gestiona = this.auth.privilegiado;

  readonly recursos = signal<Recurso[]>([]);
  readonly agencias = signal<Agencia[]>([]);
  readonly error = signal('');
  readonly tipos: TipoRecurso[] = ['patrulla', 'ambulancia', 'maquina', 'moto', 'otro'];

  nuevo: CrearRecurso = this.vacio();

  /** Id del recurso que se está editando en la tabla, y sus valores en curso. */
  readonly editando = signal<string | null>(null);
  edicion: Edicion = { codigo: '', nombre: '', tipo: 'patrulla', agenciaId: null };

  constructor() {
    // La flota y el catálogo son del tenant activo (ver RecepcionComponent).
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
      this.catalogos.agencias(true).subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    });
  }

  private cargar(): void {
    this.despacho.listarRecursos().subscribe({
      next: (r) => this.recursos.set(r),
      error: () => this.error.set('No fue posible cargar la flota.'),
    });
  }

  crear(): void {
    this.error.set('');
    const dto = { ...this.nuevo, codigo: this.nuevo.codigo.trim(), nombre: this.nuevo.nombre.trim() };
    if (!dto.codigo || !dto.nombre) { this.error.set('Código y nombre son obligatorios.'); return; }
    this.despacho.crearRecurso(dto).subscribe({
      next: (r) => { this.recursos.update((rs) => [...rs, r]); this.nuevo = this.vacio(); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el recurso.'),
    });
  }

  // --- Edición en la propia fila ------------------------------------------------

  abrirEdicion(r: Recurso): void {
    this.error.set('');
    this.editando.set(r.id);
    this.edicion = { codigo: r.codigo, nombre: r.nombre, tipo: r.tipo, agenciaId: r.agenciaId ?? null };
  }

  cancelarEdicion(): void {
    this.editando.set(null);
  }

  guardarEdicion(r: Recurso): void {
    this.error.set('');
    const codigo = this.edicion.codigo.trim();
    const nombre = this.edicion.nombre.trim();
    if (!codigo || !nombre) { this.error.set('Código y nombre son obligatorios.'); return; }
    this.despacho.actualizarRecurso(r.id, {
      codigo, nombre, tipo: this.edicion.tipo, agenciaId: this.edicion.agenciaId,
    }).subscribe({
      next: (act) => {
        this.recursos.update((rs) => rs.map((x) => (x.id === act.id ? act : x)));
        this.editando.set(null);
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible guardar el recurso.'),
    });
  }

  /**
   * Borrado definitivo. El backend lo rechaza si el recurso ya fue despachado
   * alguna vez, y en ese caso el mensaje sugiere sacarlo de servicio.
   */
  eliminar(r: Recurso): void {
    this.error.set('');
    if (!confirm(`¿Eliminar el recurso ${r.codigo} — ${r.nombre}? Esta acción no se puede deshacer.`)) return;
    this.despacho.eliminarRecurso(r.id).subscribe({
      next: () => this.recursos.update((rs) => rs.filter((x) => x.id !== r.id)),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible eliminar el recurso.'),
    });
  }

  toggleServicio(r: Recurso): void {
    const fuera = r.estado !== 'fuera_servicio';
    this.despacho.fueraServicio(r.id, fuera).subscribe({
      next: (act) => this.recursos.update((rs) => rs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible cambiar el servicio.'),
    });
  }

  estadoLabel(e: EstadoRecurso): string {
    return { disponible: 'Disponible', asignado: 'Asignado', en_ruta: 'En ruta', en_sitio: 'En sitio', fuera_servicio: 'Fuera de servicio' }[e];
  }

  puedeToggle(r: Recurso): boolean {
    return r.estado === 'disponible' || r.estado === 'fuera_servicio';
  }

  private vacio(): CrearRecurso {
    return { codigo: '', nombre: '', tipo: 'patrulla', agenciaId: null };
  }
}
