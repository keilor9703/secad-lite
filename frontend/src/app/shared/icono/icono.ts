import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Iconografía de la aplicación: trazo, no relleno.
 *
 * Van dibujados aquí y no como emoji por una razón de fondo: los emoji los
 * pinta el sistema operativo, así que cambian de forma, de color y de peso
 * entre Windows, macOS y Android — nunca hacen juego con la tipografía ni
 * entre ellos, y a tamaño pequeño se leen como manchas de colores. Un trazo
 * hereda el color del texto (`currentColor`), se alinea con la línea base y
 * mantiene el mismo peso visual en toda la barra.
 *
 * Tampoco se trae una librería completa: son quince iconos, y una dependencia
 * nueva costaría más —peso, versiones, licencias— que los trazos que caben
 * aquí. Todos comparten rejilla de 24, trazo de 1.75 y remates redondos, que
 * es lo que hace que un conjunto de iconos se vea como un conjunto.
 *
 * El marcado va literal en la plantilla, no por `innerHTML`: el saneador de
 * Angular descarta los elementos SVG de una cadena, así que un icono armado
 * de esa forma no se pintaría.
 */
export type NombreIcono =
  | 'recepcion' | 'despacho' | 'consulta' | 'recursos' | 'panel' | 'mapa'
  | 'catalogos' | 'admin' | 'plataforma' | 'monitor' | 'sala'
  | 'llave' | 'salir' | 'telefono';

@Component({
  selector: 'app-icono',
  standalone: true,
  template: `
    <svg [attr.width]="tam()" [attr.height]="tam()" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">
      @switch (nombre()) {
        @case ('recepcion') {
          <!-- Auricular con flecha entrante: lo que llega a recepción. -->
          <path d="M15 3h6v6" /><path d="M21 3l-6 6" />
          <path d="M6.5 3.5h2.2l1.6 4-2 1.3a12.5 12.5 0 0 0 5.9 5.9l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
        }
        @case ('despacho') {
          <!-- Avión de papel: el caso que sale hacia una unidad. -->
          <path d="M21.5 2.5 2.8 9.6a.6.6 0 0 0 0 1.1l7.4 3 3 7.4a.6.6 0 0 0 1.1 0z" />
          <path d="M21.5 2.5 10.2 13.7" />
        }
        @case ('consulta') {
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" />
        }
        @case ('recursos') {
          <!-- Unidad: cabina y furgón sobre dos ruedas. -->
          <path d="M2 16V7a1 1 0 0 1 1-1h11v10" /><path d="M14 9h3.5l2.5 3v4" />
          <circle cx="7" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /><path d="M9 17.5h6" />
        }
        @case ('panel') {
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <path d="M8.5 17v-5" /><path d="M14 17V8" /><path d="M19.5 17v-3" />
        }
        @case ('mapa') {
          <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" />
        }
        @case ('catalogos') {
          <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z" />
          <path d="M4 19.5A1.5 1.5 0 0 1 5.5 21H19v-3" /><path d="M8.5 7.5h6" />
        }
        @case ('admin') {
          <!-- Dos personas: quién entra y con qué permisos. -->
          <circle cx="9.5" cy="8" r="3.2" /><path d="M3.5 20a6 6 0 0 1 12 0" />
          <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.9" /><path d="M18 14.6a6 6 0 0 1 3 5.4" />
        }
        @case ('plataforma') {
          <!-- Instancias: dos edificaciones, una por municipio. -->
          <path d="M3 21V8.5L9.5 5v16" /><path d="M9.5 10.5H20a1 1 0 0 1 1 1V21" />
          <path d="M6 11.5h.01M6 15h.01M13.5 14.5h.01M17.5 14.5h.01M13.5 18h.01M17.5 18h.01" />
          <path d="M2 21h20" />
        }
        @case ('monitor') {
          <!-- Pulso: la salud de la plataforma. -->
          <path d="M3 12h3.5L9 5.5l4 13 2.5-6.5H21" />
        }
        @case ('sala') {
          <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
          <path d="M8.5 20.5h7" /><path d="M12 16.5v4" />
        }
        @case ('llave') {
          <circle cx="8" cy="15.5" r="4" /><path d="M11 12.5 20 3.5" />
          <path d="M17 6.5l2.5 2.5" /><path d="M15 8.5l2 2" />
        }
        @case ('salir') {
          <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
          <path d="M10 16l-4-4 4-4" /><path d="M6 12h10" />
        }
        @case ('telefono') {
          <path d="M6.5 3.5h2.2l1.6 4-2 1.3a12.5 12.5 0 0 0 5.9 5.9l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
        }
      }
    </svg>
  `,
  styles: [':host { display: inline-flex; flex: none; } svg { display: block; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconoComponent {
  readonly nombre = input.required<NombreIcono>();
  readonly tam = input(18);
}
