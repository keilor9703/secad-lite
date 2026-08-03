import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrearRecurso, DespachoService } from '../../core/despacho.service';
import { AuthService } from '../../core/auth.service';
import { EstadoRecurso, Recurso, TipoRecurso } from '../../core/models';

/** Gestión de la flota: listar recursos y su estado; crear y sacar/entrar de servicio. */
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

  /** Supervisor/admin pueden gestionar la flota. */
  readonly gestiona = this.auth.privilegiado;

  readonly recursos = signal<Recurso[]>([]);
  readonly error = signal('');
  readonly tipos: TipoRecurso[] = ['patrulla', 'ambulancia', 'maquina', 'moto', 'otro'];

  nuevo: CrearRecurso = this.vacio();

  constructor() {
    // La flota es del tenant activo (ver RecepcionComponent).
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
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
    return { codigo: '', nombre: '', tipo: 'patrulla', agencia: '' };
  }
}
