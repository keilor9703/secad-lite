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
 * Tampoco se trae una librería completa: son 65 iconos, y una dependencia
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
  | 'llave' | 'salir' | 'telefono' | 'soporte'
  | 'sol' | 'luna' | 'sistema' | 'mas'
  | 'flecha-der' | 'flecha-izq' | 'flecha-arriba' | 'flecha-abajo'
  | 'descargar' | 'subir' | 'volver' | 'remitir'
  | 'recargar' | 'expandir' | 'contraer' | 'cerrar'
  | 'check' | 'alerta' | 'bloqueado' | 'reloj'
  | 'pausa' | 'campana' | 'campana-off' | 'video'
  | 'pantalla' | 'micro' | 'micro-off' | 'altavoz'
  | 'silencio' | 'chat' | 'ubicacion' | 'usuario'
  | 'edificio' | 'enlace' | 'escudo' | 'documento'
  | 'candado' | 'candado-ok' | 'movil' | 'base-datos'
  | 'enchufe' | 'globo' | 'patrulla' | 'grabar'
  | 'detener' | 'pantalla-completa' | 'minimizar' | 'calor'
  | 'cluster' | 'puntos';

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
        @case ('soporte') {
          <!-- Aro de salvamento: pedir ayuda. -->
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.8" />
          <path d="M5.6 5.6l3.7 3.7" /><path d="M14.7 14.7l3.7 3.7" />
          <path d="M18.4 5.6l-3.7 3.7" /><path d="M9.3 14.7l-3.7 3.7" />
        }
        @case ('sol') {
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M4.4 12H2.2M21.8 12h-2.2" />
          <path d="M6.6 6.6 5 5M19 19l-1.6-1.6M17.4 6.6 19 5M5 19l1.6-1.6" />
        }
        @case ('luna') {
          <!-- Creciente por sustracción: un solo trazo, sin relleno. -->
          <path d="M20.5 14.3A8.8 8.8 0 0 1 9.7 3.5a8.8 8.8 0 1 0 10.8 10.8z" />
        }
        @case ('sistema') {
          <!-- Pantalla: «lo que diga el equipo». -->
          <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
          <path d="M8.5 20.5h7" /><path d="M12 17v3.5" />
        }
        @case ('telefono') {
          <path d="M6.5 3.5h2.2l1.6 4-2 1.3a12.5 12.5 0 0 0 5.9 5.9l1.3-2 4 1.6v2.2a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
        }
        @case ('flecha-der') {
          <path d="M4.5 12h15" /><path d="M13 5.5l6.5 6.5-6.5 6.5" />
        }
        @case ('flecha-izq') {
          <path d="M19.5 12h-15" /><path d="M11 18.5L4.5 12 11 5.5" />
        }
        @case ('flecha-arriba') {
          <path d="M12 19.5v-15" /><path d="M5.5 11L12 4.5 18.5 11" />
        }
        @case ('flecha-abajo') {
          <path d="M12 4.5v15" /><path d="M18.5 13L12 19.5 5.5 13" />
        }
        @case ('descargar') {
          <path d="M12 3.5v11" /><path d="M7.5 10l4.5 4.5L16.5 10" /><path d="M4.5 20h15" />
        }
        @case ('subir') {
          <path d="M12 20.5v-11" /><path d="M7.5 14L12 9.5l4.5 4.5" /><path d="M4.5 4h15" />
        }
        @case ('volver') {
          <path d="M9 14.5L4 9.5l5-5" /><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" />
        }
        @case ('remitir') {
          <path d="M15 14.5l5-5-5-5" /><path d="M20 9.5H9.5a5.5 5.5 0 0 0 0 11H13" />
        }
        @case ('recargar') {
          <path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20.5 4v4.5H16" />
        }
        @case ('expandir') {
          <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
        }
        @case ('contraer') {
          <path d="M5.5 9.5L12 16l6.5-6.5" />
        }
        @case ('cerrar') {
          <path d="M6.5 6.5l11 11" /><path d="M17.5 6.5l-11 11" />
        }
        @case ('check') {
          <path d="M4.5 12.5l5 5 10-11" />
        }
        @case ('alerta') {
          <path d="M12 4.2 2.9 20h18.2z" /><path d="M12 10v4.6" /><path d="M12 17.4h.01" />
        }
        @case ('bloqueado') {
          <circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" />
        }
        @case ('reloj') {
          <circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.3l3.4 2" />
        }
        @case ('pausa') {
          <path d="M9.5 5v14" /><path d="M14.5 5v14" />
        }
        @case ('campana') {
          <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" /><path d="M10.2 19.5a2.2 2.2 0 0 0 3.6 0" />
        }
        @case ('campana-off') {
          <path d="M18 9.5a6 6 0 0 0-8.4-5.5" /><path d="M6.2 7.6A6 6 0 0 0 6 9.5c0 5-2 6.5-2 6.5h12" /><path d="M10.2 19.5a2.2 2.2 0 0 0 3.6 0" /><path d="M3.5 3.5l17 17" />
        }
        @case ('video') {
          <rect x="3" y="6" width="12.5" height="12" rx="2.5" /><path d="M15.5 10.5 20.5 7.2v9.6l-5-3.3z" />
        }
        @case ('pantalla') {
          <rect x="3" y="4" width="18" height="12.5" rx="2" /><path d="M8.5 20.5h7" /><path d="M12 16.5v4" />
        }
        @case ('micro') {
          <rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8" /><path d="M5.8 11a6.2 6.2 0 0 0 12.4 0" /><path d="M12 17.2v4" />
        }
        @case ('micro-off') {
          <path d="M14.8 5.4v-.3a2.8 2.8 0 0 0-5.6 0v5.4" /><path d="M5.8 11a6.2 6.2 0 0 0 9.6 5.2" /><path d="M12 17.2v4" /><path d="M3.5 3.5l17 17" />
        }
        @case ('altavoz') {
          <path d="M4 9.3h3.6L12 5.3v13.4L7.6 14.7H4z" /><path d="M15.8 9.6a3.6 3.6 0 0 1 0 4.8" /><path d="M18.4 7a7.3 7.3 0 0 1 0 10" />
        }
        @case ('silencio') {
          <path d="M4 9.3h3.6L12 5.3v13.4L7.6 14.7H4z" /><path d="M16 9.8l4.5 4.4" /><path d="M20.5 9.8L16 14.2" />
        }
        @case ('chat') {
          <path d="M20.5 11.6a8 8 0 0 1-8.6 7.9 9 9 0 0 1-3.6-.8L4 20l1.4-4.2a8 8 0 1 1 15.1-4.2z" />
        }
        @case ('ubicacion') {
          <path d="M12 21s6.8-6 6.8-10.8a6.8 6.8 0 1 0-13.6 0C5.2 15 12 21 12 21z" /><circle cx="12" cy="10" r="2.6" />
        }
        @case ('usuario') {
          <circle cx="12" cy="8" r="3.8" /><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
        }
        @case ('edificio') {
          <rect x="4.5" y="3" width="15" height="18" rx="1.5" /><path d="M9 7.5h1.5" /><path d="M13.5 7.5H15" /><path d="M9 11.5h1.5" /><path d="M13.5 11.5H15" /><path d="M10 21v-3.5h4V21" />
        }
        @case ('enlace') {
          <path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l2.6-2.6a4.2 4.2 0 0 0-6-6l-1.3 1.3" /><path d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-2.6 2.6a4.2 4.2 0 0 0 6 6l1.3-1.3" />
        }
        @case ('escudo') {
          <path d="M12 3l7.2 2.9v5.7c0 4.8-3.1 7.8-7.2 9.4-4.1-1.6-7.2-4.6-7.2-9.4V5.9z" />
        }
        @case ('documento') {
          <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" /><path d="M13.5 3v5.5H19" /><path d="M8.5 13.5h7" /><path d="M8.5 17h4.5" />
        }
        @case ('candado') {
          <rect x="4.8" y="10" width="14.4" height="10.5" rx="2.2" /><path d="M8.2 10V7.2a3.8 3.8 0 0 1 7.6 0V10" />
        }
        @case ('candado-ok') {
          <rect x="4.8" y="10" width="14.4" height="10.5" rx="2.2" /><path d="M8.2 10V7.2a3.8 3.8 0 0 1 7.2-1.4" /><path d="M9.5 15.2l1.8 1.8 3.4-3.6" />
        }
        @case ('movil') {
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.8 18.5h2.4" />
        }
        @case ('base-datos') {
          <ellipse cx="12" cy="5.8" rx="7.2" ry="2.8" /><path d="M4.8 5.8v12.4c0 1.6 3.2 2.8 7.2 2.8s7.2-1.2 7.2-2.8V5.8" /><path d="M4.8 12c0 1.6 3.2 2.8 7.2 2.8s7.2-1.2 7.2-2.8" />
        }
        @case ('enchufe') {
          <path d="M9 3v5.5" /><path d="M15 3v5.5" /><path d="M6.5 8.5h11v3.2a5.5 5.5 0 0 1-11 0z" /><path d="M12 17.2V21" />
        }
        @case ('globo') {
          <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17z" />
        }
        @case ('patrulla') {
          <path d="M4 16.5v-2.8l1.9-4.4A2 2 0 0 1 7.7 8h8.6a2 2 0 0 1 1.8 1.3l1.9 4.4v2.8" /><path d="M4 13.7h16" /><circle cx="7.6" cy="16.8" r="1.7" /><circle cx="16.4" cy="16.8" r="1.7" />
        }
        @case ('grabar') {
          <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />
        }
        @case ('detener') {
          <rect x="7" y="7" width="10" height="10" rx="1.8" />
        }
        @case ('pantalla-completa') {
          <path d="M4 9.5V4h5.5" /><path d="M20 9.5V4h-5.5" /><path d="M4 14.5V20h5.5" /><path d="M20 14.5V20h-5.5" />
        }
        @case ('minimizar') {
          <path d="M5 12h14" />
        }
        @case ('calor') {
          <path d="M12 2.8c3.2 3.6 5.2 6 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-1.7.6-3.2 1.9-4.6.3 1.1.9 1.9 1.8 2.3C10.1 7.6 10.9 5.2 12 2.8z" />
        }
        @case ('cluster') {
          <circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="3.2" />
        }
        @case ('puntos') {
          <circle cx="12" cy="7.5" r="2" /><circle cx="7.8" cy="15.5" r="2" /><circle cx="16.2" cy="15.5" r="2" />
        }
        @case ('mas') {
          <!-- Tres puntos: lo que no cupo en la barra. Van RELLENOS porque a
               1.75 de trazo un círculo de 1 px de radio se ve como un anillo
               borroso, no como un punto. -->
          <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
        }
      }
    </svg>
  `,
  // `vertical-align` baja el trazo a la altura de la x de la tipografía: sin
  // esto, un icono dentro de un título o un botón se apoya en la línea base y
  // queda flotando un par de píxeles por encima del texto. En un contenedor
  // flex —la barra superior— no tiene efecto, que es lo que se quiere.
  styles: [':host { display: inline-flex; flex: none; vertical-align: -0.18em; } svg { display: block; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconoComponent {
  readonly nombre = input.required<NombreIcono>();
  readonly tam = input(18);
}
