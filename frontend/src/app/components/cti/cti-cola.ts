import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';

import { PbxService } from '../../core/pbx.service';
import { Llamada } from '../../core/models';
import { IconoComponent, NombreIcono } from '../../shared/icono/icono';

/** Cada cuánto se repinta la espera de cada llamada. */
const TIC_MS = 1000;

/**
 * LAS LLAMADAS QUE ESTÁN ESPERANDO. DE FALCON, NO DEL TELÉFONO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN COMPONENTE APARTE
 *
 * Porque se cometió el error de meterlo dentro de nuestro panel de telefonía,
 * y eso dejó sin cola a los municipios que operan con la central de un
 * tercero. El 20 de octubre de 2026 una instancia en producción se quedó
 * viendo entrar las llamadas por el contador de la barra superior **sin
 * ninguna forma de tomarlas**.
 *
 * La distinción que se pasó por alto: la cola **no es del teléfono**. Las
 * llamadas llegan al webhook de FALCON venga la central de donde venga —la
 * nuestra, YACO, Zadarma— y la fila de lo que está esperando es de FALCON.
 * Lo que cambia con el proveedor son los CONTROLES para contestar, no la
 * lista.
 *
 * Por eso esta pieza se enseña SIEMPRE, y al lado se pone el teléfono que
 * corresponda. Ver `cti-host.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ DICE CUÁNTO LLEVA ESPERANDO
 *
 * Un contador dice «5 en cola» y con eso no se decide nada: no dice si el
 * primero lleva seis segundos o seis minutos. Aquí cada llamada trae su
 * espera en vivo, y la que más ha esperado va primero.
 */
@Component({
  selector: 'app-cti-cola',
  standalone: true,
  imports: [IconoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cola">
      <h3 class="cola-h3">
        En espera
        <span class="cola-n">{{ enEspera().length }}</span>
        <button type="button" class="cola-icono" (click)="alternarSonido()"
                [title]="sonidoActivo() ? 'Silenciar el aviso de llamada entrante' : 'Activar el aviso de llamada entrante'"
                [attr.aria-label]="sonidoActivo() ? 'Silenciar aviso de llamada entrante' : 'Activar aviso de llamada entrante'">
          <app-icono [nombre]="sonidoActivo() ? 'campana' : 'campana-off'" [tam]="15" />
        </button>
      </h3>

      @for (l of enEspera(); track l.id) {
        <div class="cola-fila">
          <app-icono [nombre]="iconoOrigen(l)" [tam]="15" />
          @if (marcable(l.numero)) {
            <span class="cola-num mono">{{ l.numero }}</span>
          } @else {
            <!-- Lo que manda la central no siempre es un abonado: para los
                 contactos de WhatsApp es un identificador de sesión.
                 Enseñarlo en grande como «el número» invita a marcarlo. -->
            <span class="cola-num cola-num--sin" [title]="l.numero">Sin número</span>
          }
          <span class="cola-espera mono">{{ espera(l) }}</span>
          <button type="button" class="cola-tomar" (click)="tomar.emit(l)">Tomar</button>
        </div>
      } @empty {
        <p class="cola-vacio">Nadie esperando. Puede recepcionar un caso a mano.</p>
      }

      @if (canalEsperado() && !enVivo()) {
        <!-- Una cola vacía con el canal caído no quiere decir «no hay
             llamadas», quiere decir «dejé de enterarme». -->
        <p class="cola-aviso" role="status">
          <app-icono nombre="alerta" [tam]="14" />
          Sin conexión en vivo: una llamada entrante puede tardar en aparecer.
        </p>
      }
    </section>
  `,
  styles: `
    .cola {
      display: flex;
      flex-direction: column;
      gap: var(--esp-2);
      padding: var(--esp-4);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }

    .cola-h3 {
      display: flex;
      align-items: center;
      gap: var(--esp-2);
      margin: 0;
      font-size: var(--texto-xs);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }

    /* El contador se come el espacio sobrante y empuja la campana al borde. */
    .cola-n {
      flex: 1;
      font-size: var(--texto-md);
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
    }

    .cola-icono {
      display: inline-grid;
      place-items: center;
      padding: var(--esp-1);
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--muted);
      cursor: pointer;

      &:hover { color: var(--ink); background: var(--surface-2); }
    }

    .cola-fila {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: var(--esp-2);
      padding: var(--esp-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--ink-soft);
    }

    .cola-num {
      font-size: var(--texto-sm);
      color: var(--ink);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cola-num--sin { color: var(--muted); font-style: italic; }

    .cola-espera {
      font-size: var(--texto-xs);
      color: var(--muted);
      font-variant-numeric: tabular-nums;
    }

    .cola-tomar {
      padding: var(--esp-1) var(--esp-2);
      border: 1px solid var(--accent);
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: var(--on-accent);
      font: inherit;
      font-size: var(--texto-xs);
      cursor: pointer;

      &:hover { background: var(--accent-deep); }
    }

    .cola-vacio,
    .cola-aviso {
      margin: 0;
      font-size: var(--texto-sm);
      color: var(--muted);
    }

    .cola-aviso {
      display: flex;
      align-items: flex-start;
      gap: var(--esp-1);
      color: var(--warn);
    }

    .mono { font-family: var(--mono); }
  `,
})
export class CtiColaComponent implements OnDestroy {
  private readonly pbx = inject(PbxService);

  /**
   * El operador tomó una llamada.
   *
   * Sale como evento: qué hacer con una llamada tomada —llenar el
   * formulario, consultar la ubicación, fijar el medio— es asunto de la
   * pantalla que aloja esto, no de la lista.
   */
  readonly tomar = output<Llamada>();

  private readonly ahora = signal(Date.now());
  private readonly reloj = setInterval(() => this.ahora.set(Date.now()), TIC_MS);

  readonly sonidoActivo = this.pbx.sonidoActivo;
  readonly enVivo = this.pbx.enVivo;
  /** Una instancia sin central no tiene canal que se caiga: no se avisa. */
  readonly canalEsperado = this.pbx.canalEsperado;

  readonly enEspera = computed(() =>
    this.pbx
      .llamadas()
      .filter((l) => l.estado === 'sonando')
      // La que más ha esperado, primero. Es el único orden que corresponde a
      // cómo se debe atender una cola de emergencias.
      .sort((a, b) => +new Date(a.creadoEn) - +new Date(b.creadoEn)),
  );

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }

  alternarSonido(): void {
    this.pbx.alternarSonido();
  }

  espera(l: Llamada): string {
    const s = Math.max(0, Math.floor((this.ahora() - +new Date(l.creadoEn)) / 1000));
    const dos = (n: number) => String(n).padStart(2, '0');
    const hh = Math.floor(s / 3600);
    return hh
      ? `${hh}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`
      : `${dos(Math.floor(s / 60))}:${dos(s % 60)}`;
  }

  marcable(numero: string): boolean {
    return PbxService.esNumeroMarcable(numero);
  }

  iconoOrigen(l: Llamada): NombreIcono {
    return l.origen === 'whatsapp_llamada' || l.origen === 'whatsapp_chat'
      ? 'chat'
      : 'telefono';
  }
}
