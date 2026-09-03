import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService, CrearUsuario, EntradaBitacora } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { PbxService } from '../../core/pbx.service';
import { CtiService } from '../../core/cti.service';
import { WhatsappService } from '../../core/whatsapp.service';
import { RolesService } from '../../core/roles.service';
import { EntidadesService } from '../../core/entidades.service';
import { CatalogosService } from '../../core/catalogos.service';
import { ToastService } from '../../shared/toast/toast.service';
import {
  Agencia, CanalAtencion, CodigoCaso, CtiConfig, EntidadExterna, ModuloPermisos, PbxConfig, PermisoDef, PrioridadCaso,
  RolTenant, Tenant, TipoAgencia, UsuarioAdmin, WhatsappConfig,
} from '../../core/models';

/**
 * Funcionalidades que cruzan varios módulos (no pertenecen a uno solo): se
 * marcan aparte de los módulos, como filas sueltas de la matriz. Debe
 * coincidir con `CLAVES_TRANSVERSALES` en el backend
 * (`backend/src/roles/permiso.catalogo.ts`).
 */
const CLAVES_TRANSVERSALES = ['pbx.usar', 'whatsapp.responder'];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminComponent implements OnInit {
  private admin = inject(AdminService);
  private auth = inject(AuthService);
  private pbx = inject(PbxService);
  private cti = inject(CtiService);
  private wa = inject(WhatsappService);
  private rolesSvc = inject(RolesService);
  private entidadesSvc = inject(EntidadesService);
  private catalogosSvc = inject(CatalogosService);
  private toast = inject(ToastService);

  readonly esSuperadmin = this.auth.esSuperadmin;
  readonly gestionaRoles = this.auth.gestionaRoles;
  readonly gestionaEntidades = this.auth.tienePermiso('entidades.gestionar');
  readonly gestionaCatalogos = this.auth.tienePermiso('catalogos.gestionar');

  readonly tenants = signal<Tenant[]>([]);
  readonly usuarios = signal<UsuarioAdmin[]>([]);
  readonly error = signal('');
  /** Bitácora de administración del tenant en gestión. */
  readonly bitacora = signal<EntradaBitacora[]>([]);
  readonly bitacoraAbierta = signal(false);

  /** Tenant en gestión (lo elige el superadmin en la barra superior). */
  readonly tenantCtx = this.auth.tenantCtx;
  /** Tenant efectivo de la sesión: el propio, o el que el superadmin gestiona. */
  readonly tenantActivo = this.auth.tenantActivo;

  // Roles y permisos (RBAC dinámico)
  /** Módulos: lo que se marca/desmarca por rol (cada uno, su bundle completo). */
  readonly modulos = signal<ModuloPermisos[]>([]);
  /** Catálogo fijo de permisos, para resolver la etiqueta de lo transversal. */
  readonly permisos = signal<PermisoDef[]>([]);
  /** Funcionalidades que cruzan varios módulos: filas sueltas, aparte de los módulos. */
  readonly transversales = computed(() => this.permisos().filter((p) => CLAVES_TRANSVERSALES.includes(p.clave)));
  readonly roles = signal<RolTenant[]>([]);
  private readonly sucios = signal<Set<string>>(new Set());
  readonly haySucios = computed(() => this.sucios().size > 0);
  /** El superadmin ve la matriz solo cuando ya eligió un tenant. */
  readonly puedeVerMatriz = computed(() => this.gestionaRoles() && (!this.esSuperadmin() || !!this.tenantCtx()));
  readonly rolForm = new FormGroup({
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  readonly guardandoRoles = signal(false);
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
  readonly entidadForm = new FormGroup({
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    agenciaResponsableId: new FormControl<string | null>(null),
  });
  readonly entidadCanales = signal<string[]>([]);

  /** Edición en línea de a quién se envían los casos de una entidad ya creada. */
  readonly editandoEntidad = signal<string | null>(null);
  readonly entidadEdicionForm = new FormGroup({
    agenciaResponsableId: new FormControl<string | null>(null),
  });
  readonly entidadEdicionCanales = signal<string[]>([]);

  // Integración PBX (planta telefónica)
  readonly pbxConfig = signal<PbxConfig | null>(null);
  readonly copiado = signal('');

  // Integración CTI/YACO (barra embebida)
  readonly ctiConfig = signal<CtiConfig | null>(null);

  // Integración WhatsApp
  readonly waConfig = signal<WhatsappConfig | null>(null);
  readonly waForm = new FormGroup({
    phoneNumberId: new FormControl('', { nonNullable: true }),
    agenciaResponsableId: new FormControl<string | null>(null),
    accessToken: new FormControl('', { nonNullable: true }),
  });
  /** A quién se envían los casos que entran por WhatsApp. */
  readonly waCanales = signal<string[]>([]);
  readonly waGuardando = signal(false);
  readonly waOk = signal(false);

  // Formularios
  nuevoTenant = { codigo: '', nombre: '' };
  // Catálogos operativos (agencias, canales de atención, códigos de caso)
  readonly agencias = signal<Agencia[]>([]);
  readonly canales = signal<CanalAtencion[]>([]);
  readonly codigos = signal<CodigoCaso[]>([]);
  readonly tiposAgencia: TipoAgencia[] = ['policia', 'bomberos', 'salud', 'transito', 'gestion_riesgo', 'otra'];
  readonly prioridades: PrioridadCaso[] = ['alta', 'media', 'baja'];
  nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' as TipoAgencia };
  nuevoCanal: Record<string, { codigo: string; nombre: string }> = {};
  nuevoCodigo = { codigo: '', descripcion: '', prioridad: 'media' as PrioridadCaso, agenciaSugeridaId: '' };
  /**
   * Búsqueda dentro del catálogo de códigos. Un listado oficial trae cientos o
   * miles: se filtra por código o descripción y se muestra una tanda, para no
   * pintar toda la tabla de una vez.
   */
  filtroCodigo = '';
  readonly filtroCodigoSig = signal('');
  private readonly TOPE_CODIGOS = 100;
  readonly codigosFiltrados = computed(() => {
    const q = this.filtroCodigoSig().trim().toLowerCase();
    const todos = this.codigos();
    if (!q) return todos.slice(0, this.TOPE_CODIGOS);
    return todos
      .filter((c) => c.codigo.toLowerCase().includes(q) || c.descripcion.toLowerCase().includes(q))
      .slice(0, this.TOPE_CODIGOS);
  });
  readonly codigosCoincidentes = computed(() => {
    const q = this.filtroCodigoSig().trim().toLowerCase();
    const todos = this.codigos();
    if (!q) return todos.length;
    return todos.filter((c) => c.codigo.toLowerCase().includes(q) || c.descripcion.toLowerCase().includes(q)).length;
  });

  buscarCodigo(texto: string): void {
    this.filtroCodigo = texto;
    this.filtroCodigoSig.set(texto);
  }

  readonly usuarioForm = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    contrasena: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rol: new FormControl('operador', { nonNullable: true }),
    agenciaId: new FormControl<string | null>(null),
    extension: new FormControl<string | null>(null),
  });
  readonly usuarioCanales = signal<string[]>([]);

  constructor() {
    // Todo lo que es propio de un tenant (usuarios, roles, integraciones,
    // entidades) se recarga solo cuando cambia el tenant en gestión desde la
    // barra superior — de lo contrario queda la tanda del tenant anterior.
    effect(() => {
      const tenant = this.tenantActivo();
      this.usuarios.set([]);
      this.roles.set([]);
      this.sucios.set(new Set());
      this.rolesOk.set(false);
      this.entidades.set([]);
      this.agencias.set([]);
      this.canales.set([]);
      this.codigos.set([]);
      this.pbxConfig.set(null);
      this.ctiConfig.set(null);
      this.waConfig.set(null);
      // Sin tenant resuelto (superadmin antes de que la barra superior elija
      // uno) el backend rechaza la petición: no vale la pena intentarla.
      if (!tenant) return;
      this.cargarUsuarios();
      if (this.gestionaRoles()) this.cargarRoles();
      this.cargarPbx();
      this.cargarCti();
      this.cargarWa();
      if (this.gestionaEntidades) this.cargarEntidades();
      this.cargarCatalogos();
      this.bitacora.set([]);
      if (this.bitacoraAbierta()) this.cargarBitacora();
    });
  }

  ngOnInit(): void {
    if (this.gestionaRoles()) {
      this.rolesSvc.catalogo().subscribe({
        next: (c) => { this.modulos.set(c.modulos); this.permisos.set(c.permisos); },
        error: () => {},
      });
    }
    if (this.esSuperadmin()) this.cargarTenants();
  }

  // --- Roles y permisos -------------------------------------------------------

  /** ¿Se puede cambiar el rol de este usuario desde la tabla? */
  puedeEditarRolDe(u: UsuarioAdmin): boolean {
    if (u.rol === 'superadmin' || !u.tenant) return false;
    return this.esSuperadmin() ? u.tenant === this.tenantCtx() : true;
  }

  /** Se carga al abrir la sección (no en cada entrada a Administración). */
  alternarBitacora(): void {
    this.bitacoraAbierta.update((v) => !v);
    if (this.bitacoraAbierta() && !this.bitacora().length) this.cargarBitacora();
  }

  cargarBitacora(): void {
    this.admin.listarBitacora().subscribe({
      next: (b) => this.bitacora.set(b),
      error: () => {},
    });
  }

  private cargarRoles(): void {
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

  /** El módulo está activo solo si el rol tiene TODOS sus permisos — no basta con alguno. */
  moduloActivo(rol: RolTenant, modulo: ModuloPermisos): boolean {
    return modulo.permisos.every((p) => this.tiene(rol, p));
  }

  /**
   * Marca o desmarca un módulo completo para el rol. Al desmarcar, un permiso
   * solo se quita si NINGÚN OTRO módulo ya marcado del mismo rol lo sigue
   * necesitando (p. ej. `casos.ver` lo piden Recepción, Despacho, Consulta y
   * Catálogos a la vez) — así nunca se rompe un módulo que sigue activo por
   * apagar otro que compartía un permiso con él.
   */
  toggleModulo(rol: RolTenant, modulo: ModuloPermisos): void {
    const activo = this.moduloActivo(rol, modulo);
    let permisos: string[];
    if (activo) {
      const enUsoPorOtros = new Set<string>();
      for (const m of this.modulos()) {
        if (m.clave !== modulo.clave && this.moduloActivo(rol, m)) {
          m.permisos.forEach((p) => enUsoPorOtros.add(p));
        }
      }
      permisos = (rol.permisos ?? []).filter((p) => enUsoPorOtros.has(p) || !modulo.permisos.includes(p));
    } else {
      permisos = [...new Set([...(rol.permisos ?? []), ...modulo.permisos])];
    }
    this.roles.update((rs) => rs.map((r) => (r.id === rol.id ? { ...r, permisos } : r)));
    this.sucios.update((s) => new Set(s).add(rol.id));
    this.rolesOk.set(false);
  }

  guardarRoles(): void {
    const pendientes = this.roles().filter((r) => this.sucios().has(r.id));
    if (!pendientes.length) return;
    this.guardandoRoles.set(true);
    this.error.set('');
    let restantes = pendientes.length;
    for (const rol of pendientes) {
      this.rolesSvc.actualizar(rol.id, { permisos: rol.permisos }).subscribe({
        next: (act) => {
          this.roles.update((rs) => rs.map((r) => (r.id === act.id ? act : r)));
          this.sucios.update((s) => { const n = new Set(s); n.delete(act.id); return n; });
          if (--restantes === 0) { this.guardandoRoles.set(false); this.rolesOk.set(true); this.toast.exito('Permisos guardados.'); }
        },
        error: (e) => {
          this.guardandoRoles.set(false);
          this.error.set(e?.error?.message ?? 'No fue posible guardar los permisos.');
        },
      });
    }
  }

  crearRol(): void {
    const nombre = this.rolForm.controls.nombre.value.trim();
    if (!nombre) return;
    this.error.set('');
    this.rolesSvc.crear(nombre, []).subscribe({
      next: (r) => { this.roles.update((rs) => [...rs, r]); this.rolForm.reset(); this.toast.exito('Rol creado.'); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el rol.'),
    });
  }

  eliminarRol(rol: RolTenant): void {
    if (!window.confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return;
    this.error.set('');
    this.rolesSvc.eliminar(rol.id).subscribe({
      next: () => { this.roles.update((rs) => rs.filter((r) => r.id !== rol.id)); this.toast.exito('Rol eliminado.'); },
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
    const nombre = this.entidadForm.controls.nombre.value.trim();
    if (!nombre) return;
    this.error.set('');
    const { agenciaResponsableId } = this.entidadForm.getRawValue();
    this.entidadesSvc.crear(nombre, agenciaResponsableId, this.entidadCanales()).subscribe({
      next: (e) => {
        this.entidades.update((es) => [...es, e]);
        this.entidadForm.reset({ nombre: '', agenciaResponsableId: null });
        this.entidadCanales.set([]);
        this.keyVisible.set(e.id);
        this.toast.exito('Entidad creada.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la entidad.'),
    });
  }

  canalMarcadoEntidad(id: string): boolean {
    return this.entidadCanales().includes(id);
  }

  alternarCanalEntidad(id: string): void {
    this.entidadCanales.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
  }

  // --- Edición en línea de la entidad ya creada -------------------------------

  abrirEdicionEntidad(e: EntidadExterna): void {
    this.error.set('');
    this.editandoEntidad.set(e.id);
    this.entidadEdicionForm.reset({ agenciaResponsableId: e.agenciaResponsableId });
    this.entidadEdicionCanales.set([...(e.canales ?? [])]);
  }

  cancelarEdicionEntidad(): void {
    this.editandoEntidad.set(null);
  }

  canalMarcadoEdicionEntidad(id: string): boolean {
    return this.entidadEdicionCanales().includes(id);
  }

  alternarCanalEdicionEntidad(id: string): void {
    this.entidadEdicionCanales.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
  }

  guardarEdicionEntidad(e: EntidadExterna): void {
    this.error.set('');
    this.entidadesSvc.actualizar(e.id, {
      agenciaResponsableId: this.entidadEdicionForm.controls.agenciaResponsableId.value,
      canales: this.entidadEdicionCanales(),
    }).subscribe({
      next: (act) => {
        this.entidades.update((es) => es.map((x) => (x.id === act.id ? act : x)));
        this.editandoEntidad.set(null);
        this.toast.exito('Entidad actualizada.');
      },
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible guardar la entidad.'),
    });
  }

  toggleEntidad(e: EntidadExterna): void {
    this.entidadesSvc.actualizar(e.id, { activa: !e.activa }).subscribe({
      next: (act) => {
        this.entidades.update((es) => es.map((x) => (x.id === act.id ? act : x)));
        this.toast.exito(act.activa ? 'Entidad activada.' : 'Entidad desactivada.');
      },
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible actualizar la entidad.'),
    });
  }

  rotarEntidad(e: EntidadExterna): void {
    if (!window.confirm(`Al rotar la clave, "${e.nombre}" dejará de poder radicar casos hasta actualizarla. ¿Continuar?`)) return;
    this.entidadesSvc.rotar(e.id).subscribe({
      next: (act) => {
        this.entidades.update((es) => es.map((x) => (x.id === act.id ? act : x)));
        this.keyVisible.set(act.id);
        this.toast.exito('Clave nueva emitida. Cópiela ahora: no se vuelve a mostrar.');
      },
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible rotar la clave.'),
    });
  }

  // --- Integraciones ----------------------------------------------------------
  private cargarPbx(): void {
    this.pbx.config().subscribe({ next: (c) => this.pbxConfig.set(c), error: () => {} });
  }

  private cargarCti(): void {
    this.cti.config().subscribe({ next: (c) => this.ctiConfig.set(c), error: () => {} });
  }

  get webhookUrlCti(): string {
    const c = this.ctiConfig();
    return c ? this.cti.webhookUrl(c.webhookPath) : '';
  }

  rotarCti(): void {
    this.cti.rotarKey().subscribe({
      next: (c) => { this.ctiConfig.set(c); this.toast.exito('Clave nueva emitida. Cópiela ahora: no se vuelve a mostrar.'); },
      error: (err) => this.error.set(err?.error?.message ?? 'No fue posible rotar la clave.'),
    });
  }

  private cargarWa(): void {
    this.wa.config().subscribe({
      next: (c) => {
        this.waConfig.set(c);
        this.waForm.reset({
          phoneNumberId: c.phoneNumberId ?? '',
          agenciaResponsableId: c.agenciaResponsableId,
          accessToken: '',
        });
        this.waCanales.set([...(c.canales ?? [])]);
      },
      error: () => {},
    });
  }

  canalMarcadoWa(id: string): boolean {
    return this.waCanales().includes(id);
  }

  alternarCanalWa(id: string): void {
    this.waCanales.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
  }

  get waWebhookUrl(): string {
    const c = this.waConfig();
    return c ? this.wa.webhookUrl(c.webhookPath) : '';
  }

  guardarWa(): void {
    this.waGuardando.set(true);
    this.waOk.set(false);
    this.error.set('');
    const { phoneNumberId, agenciaResponsableId, accessToken } = this.waForm.getRawValue();
    this.wa.guardarConfig(
      phoneNumberId.trim(), accessToken.trim() || undefined,
      agenciaResponsableId, this.waCanales(),
    ).subscribe({
      next: (c) => {
        this.waConfig.set(c);
        this.waForm.patchValue({ agenciaResponsableId: c.agenciaResponsableId, accessToken: '' });
        this.waCanales.set([...(c.canales ?? [])]);
        this.waGuardando.set(false); this.waOk.set(true);
        this.toast.exito('Configuración de WhatsApp guardada.');
      },
      error: (e) => { this.waGuardando.set(false); this.error.set(e?.error?.message ?? 'No fue posible guardar la configuración de WhatsApp.'); },
    });
  }

  get webhookUrl(): string {
    const c = this.pbxConfig();
    return c ? this.pbx.webhookUrl(c.webhookPath) : '';
  }

  rotarPbx(): void {
    if (!window.confirm('Al rotar la clave, la PBX dejará de funcionar hasta actualizarla. ¿Continuar?')) return;
    this.pbx.rotarKey().subscribe({
      next: (c) => { this.pbxConfig.set(c); this.toast.exito('Clave nueva emitida. Cópiela ahora: no se vuelve a mostrar.'); },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible rotar la clave.'),
    });
  }

  copiar(texto: string | undefined | null, que: string): void {
    if (!texto) return;
    navigator.clipboard?.writeText(texto).then(() => {
      this.copiado.set(que);
      setTimeout(() => { if (this.copiado() === que) this.copiado.set(''); }, 1500);
    }).catch(() => {});
  }

  // --- Catálogos: agencias, canales y códigos de caso -------------------------

  /** Canales de una agencia (para agruparlos bajo ella). */
  canalesDe(agenciaId: string): CanalAtencion[] {
    return this.canales().filter((c) => c.agenciaId === agenciaId);
  }

  nombreAgencia(id: string | null | undefined): string {
    return this.agencias().find((a) => a.id === id)?.nombre ?? '—';
  }

  /** Nombres de los canales indicados, para mostrarlos en la tabla de usuarios. */
  nombresCanales(ids: string[]): string {
    if (!ids?.length) return '—';
    const nombres = this.canales().filter((c) => ids.includes(c.id)).map((c) => c.codigo);
    return nombres.length ? nombres.join(', ') : '—';
  }

  private cargarCatalogos(): void {
    this.catalogosSvc.agencias().subscribe({ next: (a) => this.agencias.set(a), error: () => {} });
    this.catalogosSvc.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
    this.catalogosSvc.codigos().subscribe({ next: (c) => this.codigos.set(c), error: () => {} });
  }

  crearAgencia(): void {
    this.error.set('');
    const { codigo, nombre, tipo } = this.nuevaAgencia;
    if (!codigo.trim() || !nombre.trim()) { this.error.set('Código y nombre de la agencia son obligatorios.'); return; }
    this.catalogosSvc.crearAgencia({ codigo: codigo.trim(), nombre: nombre.trim(), tipo }).subscribe({
      next: (a) => {
        this.agencias.update((as) => [...as, a]);
        this.nuevaAgencia = { codigo: '', nombre: '', tipo: 'otra' };
        this.toast.exito('Agencia creada.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear la agencia.'),
    });
  }

  alternarAgencia(a: Agencia): void {
    this.catalogosSvc.actualizarAgencia(a.id, { activo: !a.activo }).subscribe({
      next: (act) => {
        this.agencias.update((as) => as.map((x) => (x.id === act.id ? act : x)));
        // Desactivar una agencia arrastra sus canales: recargarlos evita mostrarlos activos.
        if (!act.activo) this.catalogosSvc.canales().subscribe({ next: (c) => this.canales.set(c), error: () => {} });
        this.toast.exito(act.activo ? 'Agencia activada.' : 'Agencia desactivada.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar la agencia.'),
    });
  }

  crearCanal(agencia: Agencia): void {
    this.error.set('');
    const dato = this.nuevoCanal[agencia.id] ?? { codigo: '', nombre: '' };
    if (!dato.codigo.trim() || !dato.nombre.trim()) { this.error.set('Código y nombre del canal son obligatorios.'); return; }
    this.catalogosSvc.crearCanal({ agenciaId: agencia.id, codigo: dato.codigo.trim(), nombre: dato.nombre.trim() }).subscribe({
      next: (c) => {
        this.canales.update((cs) => [...cs, c]);
        this.nuevoCanal[agencia.id] = { codigo: '', nombre: '' };
        this.toast.exito('Canal creado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el canal.'),
    });
  }

  alternarCanal(c: CanalAtencion): void {
    this.catalogosSvc.actualizarCanal(c.id, { activo: !c.activo }).subscribe({
      next: (act) => {
        this.canales.update((cs) => cs.map((x) => (x.id === act.id ? act : x)));
        this.toast.exito(act.activo ? 'Canal activado.' : 'Canal desactivado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el canal.'),
    });
  }

  crearCodigo(): void {
    this.error.set('');
    const { codigo, descripcion, prioridad, agenciaSugeridaId } = this.nuevoCodigo;
    if (!codigo.trim() || !descripcion.trim()) { this.error.set('Código y descripción son obligatorios.'); return; }
    this.catalogosSvc.crearCodigo({
      codigo: codigo.trim(), descripcion: descripcion.trim(), prioridad,
      agenciaSugeridaId: agenciaSugeridaId || null,
    }).subscribe({
      next: (c) => {
        this.codigos.update((cs) => [...cs, c]);
        this.nuevoCodigo = { codigo: '', descripcion: '', prioridad: 'media', agenciaSugeridaId: '' };
        this.toast.exito('Código de caso creado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el código de caso.'),
    });
  }

  alternarCodigo(c: CodigoCaso): void {
    this.catalogosSvc.actualizarCodigo(c.id, { activo: !c.activo }).subscribe({
      next: (act) => {
        this.codigos.update((cs) => cs.map((x) => (x.id === act.id ? act : x)));
        this.toast.exito(act.activo ? 'Código activado.' : 'Código desactivado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible actualizar el código.'),
    });
  }

  // --- Adscripción del usuario (agencia + canales) ----------------------------

  canalMarcado(id: string): boolean {
    return this.usuarioCanales().includes(id);
  }

  alternarCanalNuevo(id: string): void {
    this.usuarioCanales.update((cs) => (cs.includes(id) ? cs.filter((c) => c !== id) : [...cs, id]));
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
      next: (t) => {
        this.tenants.update((ts) => [...ts, t]);
        this.nuevoTenant = { codigo: '', nombre: '' };
        this.toast.exito('Tenant creado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el tenant.'),
    });
  }

  crearUsuario(): void {
    this.error.set('');
    const v = this.usuarioForm.getRawValue();
    const dto: CrearUsuario = {
      username: v.username.trim(), nombre: v.nombre.trim(), contrasena: v.contrasena, rol: v.rol,
      tenant: this.tenantCtx() ?? undefined, agenciaId: v.agenciaId, canales: this.usuarioCanales(),
      extension: v.extension,
    };
    if (!dto.username || !dto.nombre.trim() || !dto.contrasena) {
      this.error.set('Usuario, nombre y contraseña son obligatorios.'); return;
    }
    if (this.esSuperadmin() && !dto.tenant) { this.error.set('Seleccione el tenant del usuario.'); return; }
    this.admin.crearUsuario(dto).subscribe({
      next: (u) => {
        this.usuarios.update((us) => [...us, u]);
        this.usuarioForm.reset({ username: '', nombre: '', contrasena: '', rol: 'operador', agenciaId: null, extension: null });
        this.usuarioCanales.set([]);
        this.toast.exito('Usuario creado.');
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible crear el usuario.'),
    });
  }

  toggleActivo(u: UsuarioAdmin): void {
    this.admin.cambiarActivo(u.id, !u.activo).subscribe({
      next: (act) => {
        this.usuarios.update((us) => us.map((x) => (x.id === act.id ? act : x)));
        this.toast.exito(act.activo ? 'Usuario activado.' : 'Usuario desactivado.');
      },
      error: () => this.error.set('No fue posible actualizar el usuario.'),
    });
  }

  // --- Cambiar contraseña ------------------------------------------------------
  // Vale para cualquier fila visible, incluida la del propio superadmin cuando
  // es él quien mira la tabla (ve su propia cuenta porque `listar` no filtra
  // por tenant para su rol): el alcance real lo impone el backend.

  /** Id del usuario cuya fila tiene el campo de nueva contraseña abierto. */
  readonly cambiandoClave = signal<string | null>(null);
  readonly claveNuevaCtrl = new FormControl('', { nonNullable: true });
  /** Id del usuario cuya contraseña se acaba de guardar (confirmación breve). */
  readonly claveOk = signal<string | null>(null);

  abrirCambioClave(u: UsuarioAdmin): void {
    this.cambiandoClave.set(u.id);
    this.claveNuevaCtrl.reset('');
    this.claveOk.set(null);
  }

  cancelarCambioClave(): void {
    this.cambiandoClave.set(null);
    this.claveNuevaCtrl.reset('');
  }

  guardarClave(u: UsuarioAdmin): void {
    const clave = this.claveNuevaCtrl.value.trim();
    if (!clave) { this.error.set('Escriba la nueva contraseña.'); return; }
    this.error.set('');
    this.admin.cambiarContrasena(u.id, clave).subscribe({
      next: () => {
        this.cambiandoClave.set(null);
        this.claveNuevaCtrl.reset('');
        this.claveOk.set(u.id);
        setTimeout(() => { if (this.claveOk() === u.id) this.claveOk.set(null); }, 3000);
        this.toast.exito(`Contraseña de ${u.nombre} actualizada.`);
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible cambiar la contraseña.'),
    });
  }

  cambiarRolUsuario(u: UsuarioAdmin, rol: string): void {
    if (!rol || rol === u.rol) return;
    this.admin.cambiarRol(u.id, rol).subscribe({
      next: (act) => {
        this.usuarios.update((us) => us.map((x) => (x.id === act.id ? act : x)));
        this.toast.exito(`Rol de ${act.nombre} actualizado.`);
      },
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible cambiar el rol.'),
    });
  }

  /**
   * Extensión en la propia fila. Se guarda al perder el foco, y `undefined`
   * significa «no la toque» — enviar `null` explícito la retiraría, y eso solo
   * debe pasar si el campo quedó vacío a propósito.
   */
  guardarExtension(u: UsuarioAdmin, valor: string): void {
    const nueva = valor.trim() || null;
    if (nueva === u.extension) return;
    this.admin.cambiarExtension(u.id, nueva).subscribe({
      next: (act) => this.usuarios.update((us) => us.map((x) => (x.id === act.id ? act : x))),
      error: (e) => this.error.set(e?.error?.message ?? 'No fue posible guardar la extensión.'),
    });
  }
}
