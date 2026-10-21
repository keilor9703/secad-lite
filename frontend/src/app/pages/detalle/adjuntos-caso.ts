import {
  ChangeDetectionStrategy, Component, OnDestroy, inject, input, output, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ArchivoCaso, ArchivosService, tamanoLegible } from '../../core/archivos.service';
import { IconoComponent } from '../../shared/icono/icono';
import { NombreIcono } from '../../shared/icono/icono';
import { ToastService } from '../../shared/toast/toast.service';

/**
 * LO QUE EL CIUDADANO MANDÓ: FOTO, AUDIO, VIDEO, DOCUMENTO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * El 21/10/2026 se puso en producción la descarga de adjuntos de WhatsApp y
 * se descubrió el agujero al mirar la pantalla: el archivo SÍ se guardaba, y
 * no había ningún sitio donde verlo. La conversación decía «el ciudadano
 * envió una imagen» y ahí se acababa el rastro.
 *
 * Una nota de voz que nadie puede oír es lo mismo que una nota de voz
 * perdida, y quien se esconde de un agresor manda audio porque no puede
 * hablar: ese audio ES el reporte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NO SE BAJA NADA AL ABRIR EL CASO
 *
 * El listado es texto y cuesta nada; los bytes se bajan cuando alguien lo
 * pide. Mismo criterio que la grabación de la llamada: un operador abre
 * decenas de casos por turno y casi ninguno para mirar la foto.
 *
 * La URL de la API no se puede poner en un `<img src>`: esa ruta exige sesión
 * y una etiqueta `<img>` no manda la cabecera `Authorization`. Por eso se baja
 * por HttpClient —que pasa por el interceptor— y se enseña desde un `blob:`.
 */
@Component({
  selector: 'app-adjuntos-caso',
  standalone: true,
  imports: [CommonModule, IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cargando()) {
      <p class="adj-nota">Buscando lo que mandó el ciudadano…</p>
    } @else if (!adjuntos().length) {
      <div class="adj-vacio">
        <app-icono nombre="documento" [tam]="22" />
        <p>El ciudadano no ha mandado ninguna foto, audio ni documento.</p>
        <p class="adj-nota">
          Por WhatsApp puede mandarlos, y aparecen aquí solos. Pídaselos en la
          conversación si le sirven para atender el caso.
        </p>
      </div>
    } @else {
      <ul class="adj-lista">
        @for (a of adjuntos(); track a.id) {
          <li class="adj">
            <span class="adj-ico" aria-hidden="true">
              <app-icono [nombre]="icono(a)" [tam]="18" />
            </span>
            <span class="adj-datos">
              <span class="adj-nombre">{{ a.nombre }}</span>
              @if (a.descripcion) {
                <!-- El pie de foto es lo que el ciudadano escribió, y en una
                     emergencia suele ser el dato: «es en esta esquina». -->
                <span class="adj-pie">«{{ a.descripcion }}»</span>
              }
              <span class="adj-meta">
                {{ tamano(a.bytes) }} · {{ a.creadoEn | date: 'dd/MM HH:mm' }}
              </span>
            </span>

            @if (abiertos()[a.id]; as url) {
              @if (esImagen(a)) {
                <img class="adj-foto" [src]="url" [alt]="a.descripcion || a.nombre" />
              } @else if (esAudio(a)) {
                <audio class="adj-audio" controls [src]="url"></audio>
              } @else if (esVideo(a)) {
                <video class="adj-video" controls [src]="url"></video>
              } @else {
                <a class="btn btn--ghost mini" [href]="url" [download]="a.nombre">Guardar</a>
              }
            } @else {
              <button type="button" class="btn btn--ghost mini"
                [disabled]="bajando()[a.id]" (click)="abrir(a)">
                {{ bajando()[a.id] ? 'Bajando…' : verbo(a) }}
              </button>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }

    .adj-nota { margin: 0; color: var(--muted); font-size: var(--texto-xs); }

    .adj-vacio {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      padding: 2rem 1rem;
      color: var(--ink-soft);
      text-align: center;

      p { margin: 0; font-size: var(--texto-sm); }
    }

    .adj-lista { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }

    .adj {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 0.7rem;
      border: 1px solid var(--border-2);
      border-radius: var(--radius);
      background: var(--surface-2);
    }

    .adj-ico { color: var(--accent); display: inline-flex; }

    .adj-datos { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .adj-nombre {
      font-size: var(--texto-sm);
      color: var(--ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .adj-pie { font-size: var(--texto-sm); color: var(--ink-soft); }
    .adj-meta { font-size: var(--texto-xs); color: var(--muted); font-variant-numeric: tabular-nums; }

    /* Lo abierto ocupa la fila entera: una foto de 80 píxeles no sirve para
       reconocer una dirección ni una placa. */
    .adj-foto, .adj-video, .adj-audio {
      grid-column: 1 / -1;
      width: 100%;
      max-width: 100%;
      border-radius: var(--radius);
    }
    .adj-foto, .adj-video { max-height: 70vh; object-fit: contain; }
  `,
})
export class AdjuntosCasoComponent implements OnDestroy {
  private readonly archivos = inject(ArchivosService);
  private readonly toast = inject(ToastService);

  readonly casoId = input.required<string>();
  /** Cuántos hay, para la insignia de la pestaña. */
  readonly cantidad = output<number>();

  readonly adjuntos = signal<ArchivoCaso[]>([]);
  readonly cargando = signal(true);
  readonly bajando = signal<Record<string, boolean>>({});
  /** Los que ya se bajaron, como URL `blob:`. */
  readonly abiertos = signal<Record<string, string>>({});

  constructor() {
    // El listado se pide una vez, al montar. No hay efecto sobre `casoId`
    // porque el detalle destruye y rehace esta pestaña al cambiar de caso.
    queueMicrotask(() => this.cargar());
  }

  ngOnDestroy(): void {
    // Cada `blob:` retiene su archivo en memoria hasta que se revoca. Con
    // varias fotos por caso y un turno de ocho horas, eso se nota.
    for (const url of Object.values(this.abiertos())) URL.revokeObjectURL(url);
  }

  private cargar(): void {
    this.archivos.listarDeCaso(this.casoId()).subscribe({
      next: (todos) => {
        // Solo lo que mandó el ciudadano. Las grabaciones tienen su propio
        // sitio, con sus propios estados y su propio permiso.
        const soloAdjuntos = todos.filter((a) => a.origen === 'ADJUNTO');
        this.adjuntos.set(soloAdjuntos);
        this.cantidad.emit(soloAdjuntos.length);
        this.cargando.set(false);
      },
      error: () => {
        this.adjuntos.set([]);
        this.cargando.set(false);
      },
    });
  }

  async abrir(a: ArchivoCaso): Promise<void> {
    if (this.bajando()[a.id] || this.abiertos()[a.id]) return;
    this.bajando.update((b) => ({ ...b, [a.id]: true }));
    try {
      const blob = await this.archivos.contenido(a.id);
      this.abiertos.update((o) => ({ ...o, [a.id]: URL.createObjectURL(blob) }));
    } catch {
      // Decir qué hacer, no solo que falló: el operador tiene otra vía.
      this.toast.error(
        'No se pudo abrir el archivo. Pídaselo otra vez al ciudadano por la conversación.',
      );
    } finally {
      this.bajando.update((b) => ({ ...b, [a.id]: false }));
    }
  }

  esImagen(a: ArchivoCaso): boolean { return a.tipoMime.startsWith('image/'); }
  esAudio(a: ArchivoCaso): boolean { return a.tipoMime.startsWith('audio/'); }
  esVideo(a: ArchivoCaso): boolean { return a.tipoMime.startsWith('video/'); }

  /** El verbo del botón dice qué va a pasar: no es lo mismo ver que oír. */
  verbo(a: ArchivoCaso): string {
    if (this.esImagen(a)) return 'Ver foto';
    if (this.esAudio(a)) return 'Oír';
    if (this.esVideo(a)) return 'Ver video';
    return 'Abrir';
  }

  icono(a: ArchivoCaso): NombreIcono {
    if (this.esImagen(a)) return 'pantalla';
    if (this.esAudio(a)) return 'micro';
    if (this.esVideo(a)) return 'video';
    return 'documento';
  }

  tamano(bytes: number): string { return tamanoLegible(bytes); }
}
