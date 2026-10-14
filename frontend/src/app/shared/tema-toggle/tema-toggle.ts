import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconoComponent, NombreIcono } from '../icono/icono';
import { Tema, TemaService } from '../../core/tema.service';

/**
 * Apariencia: UN botón que dice «Tema» y muestra el icono del tema actual.
 * Al pulsarlo pasa al siguiente: claro → oscuro → según el sistema → claro.
 *
 * Antes eran tres botones en una píldora con emoji. Dos problemas, y el
 * segundo es el de fondo. El de forma: los emoji los pinta el sistema
 * operativo, así que cambian de color y de peso entre Windows, macOS y
 * Android, y a 13 píxeles se leen como manchas de colores — nunca hacen juego
 * con una barra de trazo fino. El de fondo: un control segmentado reclama el
 * espacio y la atención de una decisión importante, y elegir el tema no lo es.
 * Un botón que cicla ocupa un tercio y no compite con nada.
 */
@Component({
  selector: 'app-tema-toggle',
  standalone: true,
  imports: [IconoComponent],
  template: `
    <button type="button" class="tema" (click)="siguiente()"
      [title]="titulo()" [attr.aria-label]="titulo()">
      <span class="tema-txt">Tema</span>
      <app-icono [nombre]="icono()" [tam]="16" />
    </button>
    `,
  styles: [`
    .tema {
      display: inline-flex; align-items: center; gap: 0.4rem;
      font: inherit; font-size: 0.82rem; font-weight: 500;
      color: var(--ink-soft); cursor: pointer;
      background: transparent;
      border: 1px solid var(--border); border-radius: 999px;
      padding: 0.3rem 0.65rem;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .tema:hover { color: var(--accent); border-color: var(--border-2); background: var(--surface-2); }
    .tema:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* En pantallas angostas se queda solo el icono: la palabra no cabe y el
       botón sigue entendiéndose. */
    @media (max-width: 900px) { .tema-txt { display: none; } .tema { padding: 0.35rem; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemaToggleComponent {
  readonly tema = inject(TemaService);

  /** El orden del ciclo. «sistema» al final: es el valor por defecto, se vuelve a él. */
  private static readonly CICLO: Tema[] = ['claro', 'oscuro', 'sistema'];

  private static readonly ICONOS: Record<Tema, NombreIcono> = {
    claro: 'sol', oscuro: 'luna', sistema: 'sistema',
  };
  private static readonly NOMBRES: Record<Tema, string> = {
    claro: 'Tema claro', oscuro: 'Tema oscuro', sistema: 'Tema según el sistema',
  };

  readonly icono = computed(() => TemaToggleComponent.ICONOS[this.tema.preferencia()]);

  /**
   * El título dice en qué está Y a qué pasa: un botón que cicla sin anunciar
   * su destino obliga a probarlo para averiguarlo.
   */
  readonly titulo = computed(() => {
    const actual = this.tema.preferencia();
    const proximo = this.proximo(actual);
    return `${TemaToggleComponent.NOMBRES[actual]} · pulse para ${TemaToggleComponent.NOMBRES[proximo].toLowerCase()}`;
  });

  siguiente(): void {
    this.tema.elegir(this.proximo(this.tema.preferencia()));
  }

  private proximo(actual: Tema): Tema {
    const c = TemaToggleComponent.CICLO;
    return c[(c.indexOf(actual) + 1) % c.length];
  }
}
