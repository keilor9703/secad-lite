import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CasosService } from '../../core/casos.service';
import { AuthService } from '../../core/auth.service';
import { Canal, Caso, EstadoCaso } from '../../core/models';

/**
 * Consulta y seguimiento: la bandeja completa con búsqueda. Es la vista de
 * quien supervisa, no la de quien recepciona ni la de quien despacha — esos
 * tienen sus propios módulos, con lo que cada uno necesita a la mano.
 */
@Component({
  selector: 'app-casos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './casos.html',
  styleUrl: './casos.scss',
})
export class CasosComponent {
  private casosSvc = inject(CasosService);
  private auth = inject(AuthService);

  readonly casos = signal<Caso[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly veTodo = computed(() => this.auth.tienePermiso('casos.ver_todos'));

  readonly estados: EstadoCaso[] = ['nuevo', 'en_gestion', 'despachado', 'derivado', 'cerrado'];
  texto = '';
  private readonly busqueda = signal('');
  private readonly estadoFiltro = signal<EstadoCaso | ''>('');
  estadoSel: EstadoCaso | '' = '';

  readonly filtrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const e = this.estadoFiltro();
    return this.casos().filter((c) => {
      if (e && c.estado !== e) return false;
      if (!q) return true;
      return [c.titulo, c.ciudadano, c.direccion, c.barrio, c.codigoCaso, c.agencia]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  });

  constructor() {
    effect(() => {
      this.auth.tenantActivo();
      this.cargar();
    });
  }

  buscar(t: string): void { this.texto = t; this.busqueda.set(t); }
  filtrarEstado(e: EstadoCaso | ''): void { this.estadoSel = e; this.estadoFiltro.set(e); }

  cargar(): void {
    this.cargando.set(true);
    this.casosSvc.listar({ limite: 500 }).subscribe({
      next: (cs) => { this.casos.set(cs); this.cargando.set(false); },
      error: () => { this.error.set('No fue posible cargar los casos.'); this.cargando.set(false); },
    });
  }

  canalIcon(c: Canal): string {
    return { llamada: '📞', chat: '💬', whatsapp: '🟢', integracion: '🔌' }[c] ?? '•';
  }
  estadoLabel(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
  }
}
