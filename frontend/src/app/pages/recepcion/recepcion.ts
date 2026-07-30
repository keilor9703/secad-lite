import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { Canal, Caso, CrearCaso, EstadoCaso } from '../../core/models';

@Component({
  selector: 'app-recepcion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './recepcion.html',
  styleUrl: './recepcion.scss',
})
export class RecepcionComponent implements OnInit {
  private casosSvc = inject(CasosService);

  readonly casos = signal<Caso[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');

  readonly canales: Canal[] = ['llamada', 'chat', 'integracion'];
  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];

  readonly total = computed(() => this.casos().length);
  readonly nuevos = computed(() => this.casos().filter((c) => c.estado === 'nuevo').length);
  readonly enGestion = computed(() => this.casos().filter((c) => c.estado === 'en_gestion').length);

  mostrarForm = false;
  form: CrearCaso = this.formVacio();

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.casosSvc.listar().subscribe({
      next: (data) => { this.casos.set(data); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar la bandeja.'); this.cargando.set(false); },
    });
  }

  abrirForm(): void { this.form = this.formVacio(); this.mostrarForm = true; }
  cerrarForm(): void { this.mostrarForm = false; }

  crear(): void {
    if (!this.form.titulo?.trim() || !this.form.ciudadano?.trim()) {
      this.error.set('Título y ciudadano son obligatorios.');
      return;
    }
    this.casosSvc.crear(this.form).subscribe({
      next: (caso) => { this.casos.update((cs) => [caso, ...cs]); this.mostrarForm = false; this.error.set(''); },
      error: () => this.error.set('No fue posible crear el caso.'),
    });
  }

  cambiarEstado(caso: Caso, estado: EstadoCaso): void {
    let agencia: string | undefined;
    if (estado === 'derivado') {
      const dest = window.prompt('Agencia destino para derivar:', caso.agencia);
      if (!dest?.trim()) return;
      agencia = dest.trim();
    }
    this.casosSvc.cambiarEstado(caso.id, estado, agencia).subscribe({
      next: (act) => this.casos.update((cs) => cs.map((c) => (c.id === act.id ? act : c))),
      error: () => this.error.set('No fue posible actualizar el estado.'),
    });
  }

  // Etiquetas -----------------------------------------------------------------
  canalLabel(c: Canal): string {
    return { llamada: 'Llamada', chat: 'Chat', integracion: 'Integración' }[c];
  }
  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', integracion: '🔌' }[c];
  }
  estadoLabel(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }

  private formVacio(): CrearCaso {
    return { canal: 'llamada', titulo: '', descripcion: '', ciudadano: '', telefono: '', agencia: '', lat: null, lng: null };
  }
}
