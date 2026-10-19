import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconoComponent } from '../../shared/icono/icono';
import { ToastService } from '../../shared/toast/toast.service';
import {
  ArchivoCaso, ArchivosService, grabacionesDeLlamada, tamanoLegible,
} from '../../core/archivos.service';
import { GrabacionEnCustodia, cuerpoDeError, leerCustodia } from './custodia';

/**
 * LA GRABACIÓN DE LA LLAMADA, EN EL CASO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN COMPONENTE Y NO UN TROZO MÁS DE `detalle`
 *
 * Porque así se puede probar. `detalle` tiene setecientas líneas y seis
 * servicios inyectados; cualquier cosa que se le añada adentro nace sin
 * pruebas, y lo que se protege aquí —que una grabación fuera de línea no se
 * confunda con una perdida, que no se bajen megabytes al abrir un caso— es
 * justo lo que no se puede dejar sin probar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE BAJA AL ABRIR EL CASO
 *
 * Son megabytes por llamada y casi nadie entra al detalle a oír la grabación:
 * se lista (eso es texto) y los bytes se bajan cuando alguien lo pide. El
 * mismo criterio que ya rige la grabación de videollamada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CUATRO ESTADOS, Y UNO DE ELLOS NO ES UN FALLO
 *
 *  - **Por oír** — está en línea; un clic la baja.
 *  - **Sonando** — ya bajada, con el reproductor del navegador.
 *  - **En el archivo permanente** — EXISTE y está íntegra, pero sus bytes
 *    salieron de la nube. Se enseña el nombre con el que está guardada,
 *    porque es lo que hay que pedirle al administrador, y su verificación.
 *    Decirle «no se pudo descargar» le haría creer que se perdió.
 *  - **Subida incompleta** — la planta no terminó de subirla. No hay nada que
 *    oír, y conviene que se vea: significa que el archivo sigue en la
 *    centralita esperando.
 *
 * Quién puede ver una grabación lo decide el servidor —omite las grabaciones
 * del listado a quien no tenga `casos.ver_grabaciones`—, así que aquí no se
 * filtra nada: si la lista llega vacía, no hay nada que mostrar.
 */
@Component({
  selector: 'app-grabacion-llamada',
  standalone: true,
  imports: [CommonModule, IconoComponent],
  template: `
    @if (grabaciones().length) {
      <div class="gl">
        <span class="gl-lbl">
          <app-icono nombre="grabar" [tam]="14" />
          Grabación de la llamada
        </span>

        @for (g of grabaciones(); track g.id) {
          <div class="gl-fila">
            <div class="gl-datos">
              <span class="gl-desc">{{ g.descripcion || g.nombre }}</span>
              <span class="gl-meta">
                {{ g.creadoEn | date:'short' }} · {{ tamano(g.bytes) }}
                @if (g.estado === 'ARCHIVADO') { · en almacenamiento de objetos }
              </span>
            </div>

            @if (g.estado === 'FALLIDO') {
              <p class="gl-nota">
                Esta subida quedó incompleta: la centralita conserva el archivo y lo reintentará.
              </p>
            } @else if (custodia()[g.id]; as c) {
              <div class="gl-custodia">
                <p>
                  <strong>Esta grabación está en el archivo permanente.</strong>
                  Solicítela al administrador con este nombre:
                </p>
                <code>{{ c.archivo }}</code>
                @if (c.sha256) {
                  <p class="gl-sha">Verificación: <code>{{ c.sha256 }}</code></p>
                }
              </div>
            } @else if (urls()[g.id]; as url) {
              <audio class="gl-audio" controls preload="metadata" [src]="url"></audio>
              <a class="btn mini btn--ghost" [href]="url" [attr.download]="g.nombre">Descargar</a>
            } @else {
              <button type="button" class="btn mini" [disabled]="cargando()[g.id]"
                (click)="oir(g)">
                {{ cargando()[g.id] ? 'Descargando…' : 'Oír la grabación' }}
              </button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .gl {
      display: flex;
      flex-direction: column;
      gap: var(--esp-2);
      padding: var(--esp-3);
      margin-top: var(--esp-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radio-md);
      background: var(--surface-2);
      min-width: 0;
    }
    .gl-lbl {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: var(--texto-sm);
      font-weight: 600;
      color: var(--ink-soft);
    }
    .gl-fila { display: flex; flex-direction: column; gap: var(--esp-2); min-width: 0; }
    .gl-datos { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .gl-desc { font-size: var(--texto-sm); }
    .gl-meta { font-size: var(--texto-xs); color: var(--muted); }
    .gl-nota { margin: 0; font-size: var(--texto-sm); color: var(--muted); }
    /* El reproductor nativo: ya trae controles accesibles y teclado. */
    .gl-audio { width: 100%; max-width: 420px; }
    .gl-custodia {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: var(--esp-2) var(--esp-3);
      border-radius: var(--radio-md);
      background: var(--tag-warn-bg);
      color: var(--tag-warn-fg);
      font-size: var(--texto-sm);
    }
    .gl-custodia p { margin: 0; }
    .gl-custodia code {
      font-family: var(--fuente-mono, monospace);
      font-size: var(--texto-xs);
      overflow-wrap: anywhere;
    }
    .gl-sha { font-size: var(--texto-xs); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GrabacionLlamadaComponent implements OnDestroy {
  private api = inject(ArchivosService);
  private toast = inject(ToastService);

  readonly casoId = input.required<string>();

  private readonly archivos = signal<ArchivoCaso[]>([]);
  readonly grabaciones = computed(() => grabacionesDeLlamada(this.archivos()));

  /** Las que ya se bajaron, por id de archivo. */
  readonly urls = signal<Record<string, string>>({});
  readonly cargando = signal<Record<string, boolean>>({});
  /** Las que están en el archivo permanente, con el nombre que hay que pedir. */
  readonly custodia = signal<Record<string, GrabacionEnCustodia>>({});

  readonly tamano = tamanoLegible;

  constructor() {
    // Un `effect` y no `ngOnInit`: el caso puede cambiar sin volver a crear el
    // componente —la ruta del detalle se reutiliza al pasar de un caso a
    // otro—, y con una lectura al arrancar la ficha del segundo caso se
    // quedaría enseñando la grabación del primero.
    effect(() => {
      const id = this.casoId();
      // `untracked` porque lo que sigue LEE `urls` —para soltar las que haya—
      // y además la ESCRIBE: sin esto el efecto se dispara a sí mismo en
      // bucle y cuelga la pestaña. Es la misma trampa que ya nos costó una
      // tarde en Recepción: lo único que este efecto debe vigilar es de qué
      // caso se trata.
      untracked(() => this.limpiar());
      if (!id) return;
      this.api.listarDeCaso(id).subscribe({
        // Un caso sin archivos y un fallo al listarlos se ven igual —el bloque
        // no aparece—, y es correcto: la grabación es un extra de la ficha, no
        // su contenido. Avisar de un fallo aquí sería ruido sobre el caso.
        next: (a) => this.archivos.set(a ?? []),
        error: () => this.archivos.set([]),
      });
    });
  }

  async oir(g: ArchivoCaso): Promise<void> {
    if (this.urls()[g.id] || this.cargando()[g.id]) return;
    this.cargando.update((r) => ({ ...r, [g.id]: true }));
    try {
      const blob = await this.api.contenido(g.id);
      this.urls.update((r) => ({ ...r, [g.id]: URL.createObjectURL(blob) }));
    } catch (e) {
      // Que esté fuera de línea NO es un fallo: el archivo existe y se puede
      // pedir. Confundirlo con «no se pudo descargar» le haría creer al
      // operador que la grabación se perdió.
      const enCustodia = leerCustodia(await cuerpoDeError((e as { error?: unknown })?.error));
      if (enCustodia) {
        this.custodia.update((r) => ({ ...r, [g.id]: enCustodia }));
      } else {
        this.toast.error('No fue posible descargar la grabación.');
      }
    } finally {
      this.cargando.update((r) => ({ ...r, [g.id]: false }));
    }
  }

  ngOnDestroy(): void {
    this.soltarUrls();
  }

  /** Lo que queda del caso anterior: ni su lista ni sus bytes sirven ya. */
  private limpiar(): void {
    this.soltarUrls();
    this.archivos.set([]);
    this.urls.set({});
    this.custodia.set({});
  }

  /** Sin esto, abrir varios casos con grabación deja megabytes colgados. */
  private soltarUrls(): void {
    Object.values(this.urls()).forEach((u) => URL.revokeObjectURL(u));
  }
}
