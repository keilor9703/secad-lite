import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CatalogosService, ResultadoImportacion } from '../../core/catalogos.service';
import { AuthService } from '../../core/auth.service';
import { Agencia, CanalAtencion, CodigoCaso, CodigoCierre, PrioridadCaso, TipoAgencia } from '../../core/models';

/** Qué registro se está editando: su sección y su id. */
interface Edicion {
  seccion: 'agencia' | 'canal' | 'codigo' | 'cierre';
  id: string;
}

/**
 * Catálogos operativos del secad: las agencias que atienden, sus canales de
 * despacho, la tipificación de casos y los desenlaces con que se cierran. Es
 * configuración de la operación, no de la plataforma ni de las cuentas, por
 * eso vive fuera de Administración.
 *
 * Todo se puede crear, editar, desactivar y —si nadie lo referencia todavía—
 * eliminar. El borrado definitivo lo autoriza el backend: si el registro ya
 * dejó rastro en casos o despachos, responde 409 y aquí se muestra su motivo.
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
  readonly aviso = signal('');
  readonly agencias = signal<Agencia[]>([]);
  readonly canales = signal<CanalAtencion[]>([]);
  readonly codigos = signal<CodigoCaso[]>([]);
  readonly cierres = signal<CodigoCierre[]>([]);

  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly tenantCtx = this.auth.tenantCtx;
  readonly puedeEditar = computed(() => this.auth.tienePermiso('catalogos.gestionar'));

  readonly tiposAgencia: TipoAgencia[] = ['policia', 'bomberos', 'salud', 'transito', 'gestion_riesgo', 'otra'];
  readonly prioridades: PrioridadCaso[] = ['alta', 'media', 'baja'];

  nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' as TipoAgencia };
  nuevoCanal: Record<string, { codigo: string; nombre: string }> = {};
  nuevoCodigo = { codigo: '', descripcion: '', prioridad: 'media' as PrioridadCaso, agenciaSugeridaId: '' };
  nuevoCierre = { codigo: '', etiqueta: '' };

  /** Registro abierto para editar, y el borrador de sus campos. */
  readonly editando = signal<Edicion | null>(null);
  borrador: Record<string, string> = {};

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

  // --- Carga masiva -----------------------------------------------------------

  /** Contenido del archivo elegido y su nombre, a la espera de confirmación. */
  readonly archivoNombre = signal('');
  private csvPendiente = '';
  existentes: 'omitir' | 'actualizar' = 'omitir';
  readonly importando = signal(false);
  readonly resultado = signal<ResultadoImportacion | null>(null);

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
    this.catalogos.cierres().subscribe({ next: (c) => this.cierres.set(c), error: () => {} });
  }

  // --- Edición en la propia fila ------------------------------------------------

  /** ¿Este registro está abierto para editar? */
  edita(seccion: Edicion['seccion'], id: string): boolean {
    const e = this.editando();
    return e?.seccion === seccion && e.id === id;
  }

  abrir(seccion: Edicion['seccion'], id: string, campos: Record<string, string>): void {
    this.limpiarMensajes();
    this.editando.set({ seccion, id });
    this.borrador = { ...campos };
  }

  cerrarEdicion(): void {
    this.editando.set(null);
    this.borrador = {};
  }

  /** Mensaje de error del backend, que ya viene redactado para el operador. */
  private fallo(e: unknown, porDefecto: string): void {
    const msg = (e as { error?: { message?: string } })?.error?.message;
    this.error.set(msg ?? porDefecto);
  }

  private limpiarMensajes(): void {
    this.error.set('');
    this.aviso.set('');
  }

  // --- Agencias -----------------------------------------------------------------

  crearAgencia(): void {
    this.limpiarMensajes();
    const { codigo, nombre, tipo } = this.nuevaAgencia;
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre de la agencia son obligatorios.'); return; }
    this.catalogos.crearAgencia({ codigo: codigo.trim(), nombre: nombre.trim(), tipo }).subscribe({
      next: (a) => { this.agencias.update((as) => [...as, a]); this.nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' }; },
      error: (e) => this.fallo(e, 'No fue posible crear la agencia.'),
    });
  }

  guardarAgencia(a: Agencia): void {
    this.limpiarMensajes();
    const codigo = (this.borrador['codigo'] ?? '').trim();
    const nombre = (this.borrador['nombre'] ?? '').trim();
    if (!codigo || !nombre) { this.error.set('Código y nombre son obligatorios.'); return; }
    this.catalogos.actualizarAgencia(a.id, {
      codigo, nombre, tipo: (this.borrador['tipo'] ?? a.tipo) as TipoAgencia,
    }).subscribe({
      next: (act) => { this.agencias.update((as) => as.map((x) => (x.id === act.id ? act : x))); this.cerrarEdicion(); },
      error: (e) => this.fallo(e, 'No fue posible guardar la agencia.'),
    });
  }

  alternarAgencia(a: Agencia): void {
    this.limpiarMensajes();
    this.catalogos.actualizarAgencia(a.id, { activo: !a.activo }).subscribe({
      next: (act) => {
        this.agencias.update((as) => as.map((x) => (x.id === act.id ? act : x)));
        // Desactivar la agencia arrastra sus canales: se recargan para reflejarlo.
        if (!act.activo) this.catalogos.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
      },
      error: (e) => this.fallo(e, 'No fue posible actualizar la agencia.'),
    });
  }

  eliminarAgencia(a: Agencia): void {
    this.limpiarMensajes();
    if (!confirm(`¿Eliminar la agencia «${a.nombre}»? Esta acción no se puede deshacer.`)) return;
    this.catalogos.eliminarAgencia(a.id).subscribe({
      next: () => {
        this.agencias.update((as) => as.filter((x) => x.id !== a.id));
        this.canales.update((cs) => cs.filter((c) => c.agenciaId !== a.id));
      },
      error: (e) => this.fallo(e, 'No fue posible eliminar la agencia.'),
    });
  }

  // --- Canales ------------------------------------------------------------------

  crearCanal(agencia: Agencia): void {
    this.limpiarMensajes();
    const dato = this.nuevoCanal[agencia.id] ?? { codigo: '', nombre: '' };
    if (!dato.codigo.trim() || !dato.nombre.trim()) { this.error.set('Código y nombre del canal son obligatorios.'); return; }
    this.catalogos.crearCanal({ agenciaId: agencia.id, codigo: dato.codigo.trim(), nombre: dato.nombre.trim() }).subscribe({
      next: (c) => { this.canales.update((cs) => [...cs, c]); this.nuevoCanal[agencia.id] = { codigo: '', nombre: '' }; },
      error: (e) => this.fallo(e, 'No fue posible crear el canal.'),
    });
  }

  guardarCanal(c: CanalAtencion): void {
    this.limpiarMensajes();
    const codigo = (this.borrador['codigo'] ?? '').trim();
    const nombre = (this.borrador['nombre'] ?? '').trim();
    if (!codigo || !nombre) { this.error.set('Código y nombre son obligatorios.'); return; }
    this.catalogos.actualizarCanal(c.id, { codigo, nombre }).subscribe({
      next: (act) => { this.canales.update((cs) => cs.map((x) => (x.id === act.id ? act : x))); this.cerrarEdicion(); },
      error: (e) => this.fallo(e, 'No fue posible guardar el canal.'),
    });
  }

  alternarCanal(c: CanalAtencion): void {
    this.limpiarMensajes();
    this.catalogos.actualizarCanal(c.id, { activo: !c.activo }).subscribe({
      next: (act) => this.canales.update((cs) => cs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.fallo(e, 'No fue posible actualizar el canal.'),
    });
  }

  eliminarCanal(c: CanalAtencion): void {
    this.limpiarMensajes();
    if (!confirm(`¿Eliminar el canal «${c.nombre}»? Esta acción no se puede deshacer.`)) return;
    this.catalogos.eliminarCanal(c.id).subscribe({
      next: () => this.canales.update((cs) => cs.filter((x) => x.id !== c.id)),
      error: (e) => this.fallo(e, 'No fue posible eliminar el canal.'),
    });
  }

  // --- Códigos de caso ------------------------------------------------------------

  crearCodigo(): void {
    this.limpiarMensajes();
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
      error: (e) => this.fallo(e, 'No fue posible crear el código de caso.'),
    });
  }

  guardarCodigo(c: CodigoCaso): void {
    this.limpiarMensajes();
    const codigo = (this.borrador['codigo'] ?? '').trim();
    const descripcion = (this.borrador['descripcion'] ?? '').trim();
    if (!codigo || !descripcion) { this.error.set('Código y descripción son obligatorios.'); return; }
    this.catalogos.actualizarCodigo(c.id, {
      codigo, descripcion,
      prioridad: (this.borrador['prioridad'] ?? c.prioridad) as PrioridadCaso,
      agenciaSugeridaId: this.borrador['agenciaSugeridaId'] || null,
    }).subscribe({
      next: (act) => { this.codigos.update((cs) => cs.map((x) => (x.id === act.id ? act : x))); this.cerrarEdicion(); },
      error: (e) => this.fallo(e, 'No fue posible guardar el código.'),
    });
  }

  alternarCodigo(c: CodigoCaso): void {
    this.limpiarMensajes();
    this.catalogos.actualizarCodigo(c.id, { activo: !c.activo }).subscribe({
      next: (act) => this.codigos.update((cs) => cs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.fallo(e, 'No fue posible actualizar el código.'),
    });
  }

  eliminarCodigo(c: CodigoCaso): void {
    this.limpiarMensajes();
    if (!confirm(`¿Eliminar el código «${c.codigo}»? Esta acción no se puede deshacer.`)) return;
    this.catalogos.eliminarCodigo(c.id).subscribe({
      next: () => this.codigos.update((cs) => cs.filter((x) => x.id !== c.id)),
      error: (e) => this.fallo(e, 'No fue posible eliminar el código.'),
    });
  }

  // --- Códigos de cierre ----------------------------------------------------------

  crearCierre(): void {
    this.limpiarMensajes();
    const { codigo, etiqueta } = this.nuevoCierre;
    if (!codigo.trim() || !etiqueta.trim()) { this.error.set('Clave y etiqueta del cierre son obligatorias.'); return; }
    this.catalogos.crearCierre({ codigo: codigo.trim(), etiqueta: etiqueta.trim() }).subscribe({
      next: (c) => { this.cierres.update((cs) => [...cs, c]); this.nuevoCierre = { codigo: '', etiqueta: '' }; },
      error: (e) => this.fallo(e, 'No fue posible crear el código de cierre.'),
    });
  }

  guardarCierre(c: CodigoCierre): void {
    this.limpiarMensajes();
    const codigo = (this.borrador['codigo'] ?? '').trim();
    const etiqueta = (this.borrador['etiqueta'] ?? '').trim();
    if (!codigo || !etiqueta) { this.error.set('Clave y etiqueta son obligatorias.'); return; }
    this.catalogos.actualizarCierre(c.id, { codigo, etiqueta }).subscribe({
      next: (act) => { this.cierres.update((cs) => cs.map((x) => (x.id === act.id ? act : x))); this.cerrarEdicion(); },
      error: (e) => this.fallo(e, 'No fue posible guardar el código de cierre.'),
    });
  }

  alternarCierre(c: CodigoCierre): void {
    this.limpiarMensajes();
    this.catalogos.actualizarCierre(c.id, { activo: !c.activo }).subscribe({
      next: (act) => this.cierres.update((cs) => cs.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.fallo(e, 'No fue posible actualizar el código de cierre.'),
    });
  }

  eliminarCierre(c: CodigoCierre): void {
    this.limpiarMensajes();
    if (!confirm(`¿Eliminar el cierre «${c.etiqueta}»? Esta acción no se puede deshacer.`)) return;
    this.catalogos.eliminarCierre(c.id).subscribe({
      next: () => this.cierres.update((cs) => cs.filter((x) => x.id !== c.id)),
      error: (e) => this.fallo(e, 'No fue posible eliminar el código de cierre.'),
    });
  }

  // --- Carga y descarga del catálogo de códigos ------------------------------------

  descargarPlantilla(): void {
    this.limpiarMensajes();
    this.catalogos.descargarPlantillaCodigos().subscribe({
      next: (csv) => this.descargar(csv, 'plantilla-codigos-caso.csv'),
      error: (e) => this.fallo(e, 'No fue posible descargar la plantilla.'),
    });
  }

  exportar(): void {
    this.limpiarMensajes();
    this.catalogos.exportarCodigos().subscribe({
      next: (csv) => this.descargar(csv, `codigos-caso-${this.hoy()}.csv`),
      error: (e) => this.fallo(e, 'No fue posible exportar el catálogo.'),
    });
  }

  /** Lee el archivo elegido; no se envía nada hasta que se confirme. */
  elegirArchivo(evento: Event): void {
    this.limpiarMensajes();
    this.resultado.set(null);
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    this.archivoNombre.set(archivo.name);
    const lector = new FileReader();
    lector.onload = () => {
      this.csvPendiente = String(lector.result ?? '');
      // Primero una simulación: el operador ve qué pasaría antes de escribir.
      this.enviarImportacion(true);
    };
    lector.onerror = () => this.error.set('No fue posible leer el archivo.');
    lector.readAsText(archivo, 'utf-8');
  }

  /** Aplica de verdad lo que la simulación ya mostró. */
  confirmarImportacion(): void {
    this.enviarImportacion(false);
  }

  private enviarImportacion(simulacion: boolean): void {
    if (!this.csvPendiente.trim()) { this.error.set('Elija primero un archivo.'); return; }
    this.limpiarMensajes();
    this.importando.set(true);
    this.catalogos.importarCodigos(this.csvPendiente, { existentes: this.existentes, simulacion }).subscribe({
      next: (r) => {
        this.importando.set(false);
        this.resultado.set(r);
        if (!simulacion) {
          this.aviso.set(`Importación aplicada: ${r.creados} creados, ${r.actualizados} actualizados.`);
          this.csvPendiente = '';
          this.archivoNombre.set('');
          this.catalogos.codigos().subscribe({ next: (c) => this.codigos.set(c), error: () => {} });
        }
      },
      error: (e) => { this.importando.set(false); this.fallo(e, 'No fue posible procesar el archivo.'); },
    });
  }

  descartarImportacion(): void {
    this.csvPendiente = '';
    this.archivoNombre.set('');
    this.resultado.set(null);
    this.limpiarMensajes();
  }

  /** Cuántas filas del archivo sí entrarían (o entraron). */
  aceptadas(r: ResultadoImportacion): number {
    return r.creados + r.actualizados;
  }

  private descargar(contenido: string, nombre: string): void {
    // BOM para que Excel abra el archivo en UTF-8 y no destroce las tildes.
    const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }

  private hoy(): string {
    const d = new Date();
    const dos = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}`;
  }
}
