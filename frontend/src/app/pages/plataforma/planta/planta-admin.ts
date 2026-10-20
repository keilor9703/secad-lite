import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { IconoComponent } from '../../../shared/icono/icono';
import { SelectorComponent } from '../../../shared/selector/selector';
import { OpcionComponent } from '../../../shared/selector/opcion';
import { ToastService } from '../../../shared/toast/toast.service';
import { ConfirmService } from '../../../shared/confirm/confirm.service';
import { AdminService } from '../../../core/admin.service';
import { Tenant } from '../../../core/models';
import {
  ArchivoPlanta, AutenticacionTroncal, ConfiguracionPlanta, EstadoPlanta, NumeroVisible,
  PlantaService, PlantaVisible, SaludPlanta, TipoNumero, TroncalVisible,
} from '../../../core/planta.service';

/**
 * NUESTRAS CENTRALITAS — dar de alta la planta de un municipio sin SSH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUÉ DECIDE ESTA PANTALLA: NADA DE TELEFONÍA
 *
 * Ni un puerto, ni un nombre de archivo, ni qué le falta a una planta se
 * calcula aquí. Todo eso lo dice el servidor, que es el único que puede
 * garantizar que dos municipios no se pisen los puertos de un mismo host —el
 * navegador no sabe qué más hay en ese servidor, y dos pestañas abiertas
 * calcularían lo mismo dos veces—.
 *
 * Lo que la pantalla sí hace, y es su razón de existir: poner en orden lo que
 * hay que llenar, enseñar lo que el servidor va a instalar ANTES de
 * instalarlo, y decir en una lista legible qué le falta a cada planta para
 * atender una llamada. Eso es lo que convierte veinte minutos de terminal en
 * un formulario.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS BOTONES Y LA DIFERENCIA ENTRE ELLOS
 *
 * «Ver configuración» muestra los archivos con las claves sustituidas y no
 * toca nada. «Aplicar» entrega los archivos de verdad y, de paso, RENUEVA la
 * API key de la instancia —FALCON guarda su digest, no la clave, así que no
 * hay forma de volver a leer la actual—. Entre una y otra hay una
 * confirmación explícita, porque mientras los archivos nuevos no estén
 * instalados, la central no puede avisar de las llamadas.
 */
@Component({
  selector: 'app-planta-admin',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, FormsModule,
    IconoComponent, SelectorComponent, OpcionComponent,
  ],
  templateUrl: './planta-admin.html',
  styleUrl: './planta-admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlantaAdminComponent implements OnInit {
  private api = inject(PlantaService);
  private admin = inject(AdminService);
  private toast = inject(ToastService);
  private confirm = inject(ConfirmService);

  readonly plantas = signal<PlantaVisible[]>([]);
  readonly tenants = signal<Tenant[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly guardando = signal(false);

  /** Qué planta está abierta. Una a la vez: son pantallas densas. */
  readonly abierta = signal('');
  readonly actual = computed(() => this.plantas().find((p) => p.tenant === this.abierta()) ?? null);

  readonly estados: EstadoPlanta[] = ['borrador', 'provisionada', 'activa', 'suspendida'];
  readonly autenticaciones: AutenticacionTroncal[] = ['ip', 'registro', 'digest'];
  readonly tipos: TipoNumero[] = ['did', 'corto'];

  /** Solo las instancias que todavía no tienen planta propia. */
  readonly sinPlanta = computed(() => {
    const conPlanta = new Set(this.plantas().map((p) => p.tenant));
    return this.tenants().filter((t) => !conPlanta.has(t.codigo));
  });

  /** Los servidores que ya se usan: dar de alta la segunda planta es elegir, no teclear. */
  readonly servidores = computed(() => [...new Set(this.plantas().map((p) => p.servidor))].sort());

  readonly altaForm = new FormGroup({
    tenant: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    servidor: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ipPublica: new FormControl(''),
    dominioSip: new FormControl(''),
  });

  readonly datosForm = new FormGroup({
    servidor: new FormControl('', { nonNullable: true }),
    ipPublica: new FormControl(''),
    ipInterna: new FormControl(''),
    ipPrivada: new FormControl(''),
    dominioSip: new FormControl('', { nonNullable: true }),
    notas: new FormControl(''),
  });

  /**
   * Los puertos solo se editan a pedido, y no por prudencia decorativa: el
   * reparto lo hace el servidor y acertar a mano es difícil. Se abre para
   * REGISTRAR una planta que ya existe con otros puertos —la nuestra escucha
   * SIP en el 3478 porque no se pudo abrir el 5060—.
   */
  readonly editandoPuertos = signal(false);
  readonly puertosForm = new FormGroup({
    puertoSip: new FormControl(0, { nonNullable: true }),
    rtpDesde: new FormControl(0, { nonNullable: true }),
    rtpHasta: new FormControl(0, { nonNullable: true }),
    puertoHttp: new FormControl(0, { nonNullable: true }),
  });

  readonly troncalEditando = signal<string | null>(null);
  readonly troncalForm = new FormGroup({
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    proveedor: new FormControl('INFOBIP', { nonNullable: true }),
    servidor: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    puerto: new FormControl(5060, { nonNullable: true }),
    autenticacion: new FormControl<AutenticacionTroncal>('ip', { nonNullable: true }),
    usuario: new FormControl(''),
    clave: new FormControl(''),
    redes: new FormControl(''),
    canales: new FormControl(10, { nonNullable: true }),
    prioridad: new FormControl(1, { nonNullable: true }),
    activa: new FormControl(true, { nonNullable: true }),
  });

  readonly numeroEditando = signal<string | null>(null);
  readonly numeroForm = new FormGroup({
    numero: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tipo: new FormControl<TipoNumero>('did', { nonNullable: true }),
    troncalId: new FormControl<string | null>(null),
    destino: new FormControl('cola', { nonNullable: true }),
    descripcion: new FormControl(''),
    activo: new FormControl(true, { nonNullable: true }),
  });

  /** La configuración generada, cuando se pidió ver o aplicar. */
  readonly config = signal<ConfiguracionPlanta | null>(null);
  readonly archivoAbierto = signal('');

  /**
   * La última revisión automática de la planta abierta.
   *
   * Se carga al abrir la ficha, no al listar: son tres conexiones contra la
   * planta y la lista se mira muchas más veces que una ficha concreta.
   */
  readonly salud = signal<SaludPlanta | null>(null);
  readonly revisando = signal(false);

  ngOnInit(): void {
    this.cargar();
    this.admin.listarTenants().subscribe({
      next: (t) => this.tenants.set(t),
      // Sin la lista de instancias se puede seguir: el alta pide el código a
      // mano. No es motivo para dejar la pantalla en blanco.
      error: () => this.tenants.set([]),
    });
  }

  cargar(): void {
    this.cargando.set(true);
    this.api.listar().subscribe({
      next: (p) => { this.plantas.set(p); this.cargando.set(false); this.error.set(''); },
      error: (e) => { this.error.set(this.porQue(e)); this.cargando.set(false); },
    });
  }

  abrir(tenant: string): void {
    if (this.abierta() === tenant) { this.abierta.set(''); return; }
    this.abierta.set(tenant);
    this.config.set(null);
    this.salud.set(null);
    this.api.salud(tenant).subscribe({
      next: (s) => this.salud.set(s),
      // Que no haya revisión todavía no es un error que mostrar: una planta
      // recién dada de alta no tiene ninguna.
      error: () => this.salud.set(null),
    });
    this.editandoPuertos.set(false);
    this.troncalEditando.set(null);
    this.numeroEditando.set(null);
    const p = this.plantas().find((x) => x.tenant === tenant);
    if (!p) return;
    this.datosForm.reset({
      servidor: p.servidor,
      ipPublica: p.ipPublica,
      ipInterna: p.ipInterna,
      ipPrivada: p.ipPrivada,
      dominioSip: p.dominioSip,
      notas: p.notas ?? '',
    });
    this.puertosForm.reset({
      puertoSip: p.puertoSip,
      rtpDesde: p.rtpDesde,
      rtpHasta: p.rtpHasta,
      puertoHttp: p.puertoHttp,
    });
  }

  /**
   * Revisa la planta ahora mismo.
   *
   * Es lo que evita el «entre por SSH y mire»: después de tocar algo en el
   * servidor, esto dice en dos segundos si quedó bien.
   */
  revisarAhora(): void {
    const tenant = this.abierta();
    if (!tenant || this.revisando()) return;
    this.revisando.set(true);
    this.api.revisar(tenant).subscribe({
      next: () => {
        this.api.salud(tenant).subscribe({
          next: (s) => { this.salud.set(s); this.revisando.set(false); },
          error: () => this.revisando.set(false),
        });
        this.toast.exito('Planta revisada.');
      },
      error: (e) => {
        this.revisando.set(false);
        this.toast.error(this.porQue(e));
      },
    });
  }

  /** Qué deja de poder hacer el ciudadano con cada falla. */
  queSignifica(falla: string): string {
    return {
      asterisk: 'La central no responde: no entran llamadas y el softphone no conecta.',
      troncal: 'La central responde pero la troncal no está disponible: las llamadas no llegan.',
      certificado: 'El certificado está por vencer; ese día el softphone deja de conectar.',
      'certificado-vencido': 'El certificado venció: el softphone ya no puede conectar.',
    }[falla] ?? falla;
  }

  // ── Alta y edición ────────────────────────────────────────────────────────

  crear(): void {
    if (this.altaForm.invalid || this.guardando()) return;
    const v = this.altaForm.getRawValue();
    this.guardando.set(true);
    this.api.crear({
      tenant: v.tenant.trim(),
      servidor: v.servidor.trim(),
      ipPublica: v.ipPublica?.trim() || null,
      dominioSip: v.dominioSip?.trim() || null,
    }).subscribe({
      next: (p) => {
        this.guardando.set(false);
        this.altaForm.reset({ tenant: '', servidor: v.servidor, ipPublica: '', dominioSip: '' });
        this.toast.exito(
          `Planta de «${p.tenant}» reservada: SIP ${p.puertoSip}, RTP ${p.rtpDesde}-${p.rtpHasta}, `
          + `HTTP ${p.puertoHttp}.`,
        );
        this.cargar();
        this.abrir(p.tenant);
      },
      error: (e) => { this.guardando.set(false); this.toast.error(this.porQue(e)); },
    });
  }

  guardarDatos(): void {
    const tenant = this.abierta();
    if (!tenant || this.guardando()) return;
    const v = this.datosForm.getRawValue();
    this.enviar(this.api.actualizar(tenant, {
      servidor: v.servidor.trim(),
      ipPublica: v.ipPublica?.trim() || null,
      ipInterna: v.ipInterna?.trim() || null,
      ipPrivada: v.ipPrivada?.trim() || null,
      dominioSip: v.dominioSip.trim(),
      notas: v.notas?.trim() || null,
    }), 'Datos de la planta guardados.');
  }

  guardarPuertos(): void {
    const tenant = this.abierta();
    if (!tenant || this.guardando()) return;
    const v = this.puertosForm.getRawValue();
    this.enviar(this.api.actualizar(tenant, {
      puertoSip: Number(v.puertoSip),
      rtpDesde: Number(v.rtpDesde),
      rtpHasta: Number(v.rtpHasta),
      puertoHttp: Number(v.puertoHttp),
    }), 'Puertos guardados.', () => this.editandoPuertos.set(false));
  }

  cambiarEstado(estado: EstadoPlanta): void {
    const tenant = this.abierta();
    if (!tenant) return;
    this.enviar(this.api.actualizar(tenant, { estado }), `La planta queda ${estado}.`);
  }

  async eliminar(p: PlantaVisible): Promise<void> {
    const ok = await this.confirm.preguntar(
      `Se borra la planta de «${p.tenant}» y se liberan sus puertos (SIP ${p.puertoSip}, `
      + `RTP ${p.rtpDesde}-${p.rtpHasta}). Solo se puede porque nunca se montó en el servidor.`,
      { titulo: 'Borrar la planta', textoAceptar: 'Borrar', peligro: true },
    );
    if (!ok) return;
    this.api.eliminar(p.tenant).subscribe({
      next: () => { this.abierta.set(''); this.toast.exito('Planta borrada.'); this.cargar(); },
      error: (e) => this.toast.error(this.porQue(e)),
    });
  }

  // ── Troncales ─────────────────────────────────────────────────────────────

  editarTroncal(t: TroncalVisible | null): void {
    this.troncalEditando.set(t?.id ?? null);
    this.troncalForm.reset({
      nombre: t?.nombre ?? '',
      proveedor: t?.proveedor ?? 'INFOBIP',
      servidor: t?.servidor ?? '',
      puerto: t?.puerto ?? 5060,
      autenticacion: t?.autenticacion ?? 'ip',
      usuario: t?.usuario ?? '',
      // La clave nunca viene del servidor: el campo arranca vacío y, vacío,
      // conserva la que haya guardada.
      clave: '',
      redes: t?.redes.join(', ') ?? '',
      canales: t?.canales ?? 10,
      prioridad: t?.prioridad ?? 1,
      activa: t?.activa ?? true,
    });
  }

  guardarTroncal(): void {
    const tenant = this.abierta();
    if (!tenant || this.troncalForm.invalid || this.guardando()) return;
    const v = this.troncalForm.getRawValue();
    const id = this.troncalEditando();
    this.enviar(this.api.guardarTroncal(tenant, {
      id: id ?? undefined,
      nombre: v.nombre.trim(),
      proveedor: v.proveedor.trim(),
      servidor: v.servidor.trim(),
      puerto: Number(v.puerto),
      autenticacion: v.autenticacion,
      usuario: v.usuario?.trim() || null,
      clave: v.clave?.trim() || undefined,
      redes: v.redes?.trim() || null,
      canales: Number(v.canales),
      prioridad: Number(v.prioridad),
      activa: v.activa,
    }), 'Troncal guardada.', () => this.editarTroncal(null));
  }

  async eliminarTroncal(t: TroncalVisible): Promise<void> {
    const tenant = this.abierta();
    const ok = await this.confirm.preguntar(
      `Se borra la troncal «${t.nombre}». Los números que entraban por ella quedan sin troncal.`,
      { titulo: 'Borrar la troncal', textoAceptar: 'Borrar', peligro: true },
    );
    if (!ok || !tenant) return;
    this.api.eliminarTroncal(tenant, t.id).subscribe({
      next: () => { this.toast.exito('Troncal borrada.'); this.cargar(); },
      error: (e) => this.toast.error(this.porQue(e)),
    });
  }

  // ── Números ───────────────────────────────────────────────────────────────

  editarNumero(n: NumeroVisible | null): void {
    this.numeroEditando.set(n?.id ?? null);
    this.numeroForm.reset({
      numero: n?.numero ?? '',
      tipo: n?.tipo ?? 'did',
      troncalId: n?.troncalId ?? null,
      destino: n?.destino ?? 'cola',
      descripcion: n?.descripcion ?? '',
      activo: n?.activo ?? true,
    });
  }

  guardarNumero(): void {
    const tenant = this.abierta();
    if (!tenant || this.numeroForm.invalid || this.guardando()) return;
    const v = this.numeroForm.getRawValue();
    const id = this.numeroEditando();
    this.enviar(this.api.guardarNumero(tenant, {
      id: id ?? undefined,
      numero: v.numero.trim(),
      tipo: v.tipo,
      troncalId: v.troncalId,
      destino: v.destino?.trim() || 'cola',
      descripcion: v.descripcion?.trim() || null,
      activo: v.activo,
    }), 'Número guardado.', () => this.editarNumero(null));
  }

  async eliminarNumero(n: NumeroVisible): Promise<void> {
    const tenant = this.abierta();
    const ok = await this.confirm.preguntar(
      `Se borra el número ${n.numero}. Las llamadas que entren por él dejarán de tener regla propia.`,
      { titulo: 'Borrar el número', textoAceptar: 'Borrar', peligro: true },
    );
    if (!ok || !tenant) return;
    this.api.eliminarNumero(tenant, n.id).subscribe({
      next: () => { this.toast.exito('Número borrado.'); this.cargar(); },
      error: (e) => this.toast.error(this.porQue(e)),
    });
  }

  // ── La configuración ──────────────────────────────────────────────────────

  verConfiguracion(): void {
    const tenant = this.abierta();
    if (!tenant) return;
    this.api.previa(tenant).subscribe({
      next: (c) => { this.config.set(c); this.archivoAbierto.set(c.archivos[0]?.ruta ?? ''); },
      error: (e) => this.toast.error(this.porQue(e)),
    });
  }

  /**
   * Aplicar renueva la API key de la instancia, así que se pregunta antes y
   * se dice exactamente qué deja de funcionar mientras tanto. Un «¿está
   * seguro?» sin decir qué se rompe no es una confirmación, es un trámite.
   */
  async aplicar(): Promise<void> {
    const p = this.actual();
    if (!p) return;
    const ok = await this.confirm.preguntar(
      `Se generan los archivos de la planta de «${p.tenant}» y se RENUEVA la API key de la `
      + 'instancia (FALCON guarda su digest, no la clave, así que no se puede reutilizar). '
      + 'Mientras no instale los archivos nuevos en el servidor, la central no podrá avisar de '
      + 'las llamadas a FALCON.',
      { titulo: 'Aplicar la configuración', textoAceptar: 'Generar y renovar', peligro: true },
    );
    if (!ok) return;
    this.api.aplicar(p.tenant).subscribe({
      next: (c) => {
        this.config.set(c);
        this.archivoAbierto.set('aplicar.sh');
        this.toast.exito('Configuración generada. Copie aplicar.sh al servidor y ejecútelo.');
        this.cargar();
      },
      error: (e) => this.toast.error(this.porQue(e)),
    });
  }

  archivo(ruta: string): ArchivoPlanta | null {
    return this.config()?.archivos.find((a) => a.ruta === ruta) ?? null;
  }

  async copiar(a: ArchivoPlanta): Promise<void> {
    try {
      await navigator.clipboard.writeText(a.contenido);
      this.toast.exito(`${a.ruta} copiado al portapapeles.`);
    } catch {
      this.toast.advertencia('El navegador no dejó copiar. Seleccione el texto y cópielo a mano.');
    }
  }

  /** Descargar el archivo tal cual, para subirlo al servidor con scp. */
  descargar(a: ArchivoPlanta): void {
    const url = URL.createObjectURL(new Blob([a.contenido], { type: 'text/plain' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = a.ruta.split('/').pop() ?? 'archivo.txt';
    enlace.click();
    URL.revokeObjectURL(url);
  }

  /** El tono de la píldora de estado: el que lee el ojo antes que el texto. */
  tono(estado: EstadoPlanta): string {
    if (estado === 'activa') return 'badge--ok';
    if (estado === 'provisionada') return 'badge--teal';
    if (estado === 'suspendida') return 'badge--danger';
    return 'badge--warn';
  }

  private enviar(
    peticion: { subscribe: (o: { next: (v: unknown) => void; error: (e: unknown) => void }) => void },
    exito: string,
    luego?: () => void,
  ): void {
    this.guardando.set(true);
    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.toast.exito(exito);
        luego?.();
        this.cargar();
      },
      error: (e) => { this.guardando.set(false); this.toast.error(this.porQue(e)); },
    });
  }

  /**
   * El motivo que manda el servidor, que es el que sirve: «el puerto 5060 ya
   * lo usa otra planta de este servidor» le dice qué hacer. «Error 409» no.
   */
  private porQue(e: unknown): string {
    const err = e as { error?: { message?: string | string[] }; message?: string };
    const m = err?.error?.message ?? err?.message;
    return Array.isArray(m) ? m.join(' · ') : (m ?? 'El servidor no respondió.');
  }
}
