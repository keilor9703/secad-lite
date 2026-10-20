import { TestBed } from '@angular/core/testing';

import { DetalleLlamadasModalComponent } from './detalle-llamadas';
import { ESTADOS_LLAMADA } from '../../core/models';

/**
 * LA LISTA DE LLAMADAS.
 *
 * Que ningún estado llegue a la pantalla con su nombre interno lo garantiza
 * ANTES el compilador: el objeto de etiquetas se indexa con el tipo
 * `EstadoLlamada`, así que si falta una clave TypeScript lo rechaza
 * («Property 'desbordada' does not exist»). Está comprobado.
 *
 * Esta prueba cubre lo que el compilador NO ve: el `?? e` del final. Ese
 * operador existe por si llegara un estado fuera del tipo —datos viejos, una
 * central que inventa uno— y es precisamente el que dejaría pasar un nombre
 * interno en silencio el día que alguien ensanche el tipo o afloje el
 * indexado. Por eso se recorren todos los estados en vez de comprobar uno.
 */
describe('DetalleLlamadasModalComponent', () => {
  const crear = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.runInInjectionContext(() => new DetalleLlamadasModalComponent());
  };

  it('TODOS los estados tienen nombre en español, sin excepción', () => {
    const c = crear();
    for (const estado of ESTADOS_LLAMADA) {
      const texto = c.estadoLabel(estado);
      expect(texto).not.toBe(estado);
      expect(texto.length).toBeGreaterThan(0);
    }
  });

  it('la desbordada se nombra por lo que pasó, no por el estado', () => {
    // «Al respaldo» y no «Desbordada»: quien lee la lista necesita saber qué
    // pasó con la llamada, no cómo se llama el estado por dentro.
    expect(crear().estadoLabel('desbordada')).toBe('Al respaldo');
  });

  it('la desbordada NO se nombra igual que la perdida', () => {
    // Es la distinción que todo esto viene a conservar: «no alcanzamos a
    // contestar» no es «nadie se enteró de que había una llamada».
    const c = crear();
    expect(c.estadoLabel('desbordada')).not.toBe(c.estadoLabel('perdida'));
  });
});
