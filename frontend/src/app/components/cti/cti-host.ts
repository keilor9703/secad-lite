import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';

import { PbxService } from '../../core/pbx.service';
import { Llamada } from '../../core/models';
import { CtiComponent } from './cti';

/**
 * EL SITIO DEL TELÉFONO EN LA PANTALLA, SEA DE QUIEN SEA EL TELÉFONO.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE UNA PIEZA SOLO PARA ELEGIR
 *
 * Un municipio puede operar con NUESTRA centralita o con la de un tercero
 * —hoy YACO—, y eso ya está decidido en Plataforma: es el proveedor de
 * `config_pbx`. Lo que no puede pasar es que la pantalla de Recepción tenga
 * que saberlo. Recepción pide «el teléfono» y aquí se resuelve cuál.
 *
 * La alternativa era un `@if` en Recepción con la lista de proveedores
 * dentro. Eso significa que el día que entre un tercer proveedor hay que
 * tocar cada pantalla que aloje un teléfono, y que la pantalla de Recepción
 * —que es de recepcionar casos— pasa a tener opinión sobre telefonía.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE HOY NO EXISTE SE DICE, NO SE SIMULA
 *
 * La barra de YACO la está construyendo el tercero y todavía no la tenemos.
 * Aquí no se dibuja una barra falsa que parezca la suya: se deja el sitio
 * reservado y se dice qué va a ir ahí y por qué todavía no está. Una maqueta
 * en producción es una promesa que alguien va a creerse.
 */
@Component({
  selector: 'app-cti-host',
  standalone: true,
  imports: [CtiComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (cual()) {
      @case ('propia') {
        <app-cti (tomar)="tomar.emit($event)" />
      }
      @case ('yaco') {
        <section class="cti-ajeno">
          <h3>Teléfono de YACO</h3>
          <p>
            Esta instancia opera con la centralita de YACO, así que el teléfono
            del operador es el de ellos. Su barra se integra aquí cuando la
            entreguen.
          </p>
          <p class="cti-ajeno-nota">
            Mientras tanto, las llamadas siguen llegando a FALCON y los casos se
            crean igual: lo que falta es contestar desde esta pantalla.
          </p>
        </section>
      }
      @default {
        <section class="cti-ajeno">
          <h3>Sin teléfono</h3>
          <p>
            Esta instancia no tiene una centralita configurada, o está apagada.
            Un administrador la registra en Plataforma → Centralitas.
          </p>
        </section>
      }
    }
  `,
  styles: `
    .cti-ajeno {
      display: flex;
      flex-direction: column;
      gap: var(--esp-2);
      padding: var(--esp-4);
      background: var(--surface);
      border: 1px dashed var(--border-2);
      border-radius: var(--radius);

      h3 {
        margin: 0;
        font-size: var(--texto-md);
        color: var(--ink);
      }

      p {
        margin: 0;
        font-size: var(--texto-sm);
        color: var(--ink-soft);
      }
    }

    .cti-ajeno-nota { color: var(--muted) !important; }
  `,
})
export class CtiHostComponent {
  private readonly pbx = inject(PbxService);

  /** El operador tomó una llamada de la cola. Lo resuelve quien aloja esto. */
  readonly tomar = output<Llamada>();

  /**
   * Qué teléfono corresponde a esta instancia.
   *
   * Se mira el proveedor y NO las capacidades: una planta propia apagada
   * sigue siendo una planta propia, y lo que hay que enseñar entonces es
   * nuestro panel diciendo que el teléfono está caído —que es información—
   * en vez de un hueco que no explica nada. El `null` es para la instancia
   * que de verdad no tiene centralita.
   */
  readonly cual = computed<'propia' | 'yaco' | 'ninguna'>(() => {
    const p = this.pbx.capacidades()?.proveedor?.toUpperCase();
    if (!p) return 'ninguna';
    if (p === 'YACO') return 'yaco';
    return 'propia';
  });
}
