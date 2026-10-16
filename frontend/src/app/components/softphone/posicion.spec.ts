import { acotar, guardarPosicion, posicionGuardada, posicionPorDefecto } from './posicion';

/**
 * Dónde vive la barra del teléfono.
 *
 * Es aritmética, y la aritmética de posiciones falla de formas que no se ven
 * en una pantalla grande: la barra queda fuera al cambiar de monitor, o medio
 * cuerpo afuera al desplegarse, o pegada al filo donde no se puede agarrar.
 */
describe('la posición de la barra', () => {
  const PANTALLA = { ventanaAncho: 1440, ventanaAlto: 900, barraAncho: 300, barraAlto: 46 };

  describe('por defecto', () => {
    it('arriba a la derecha, bajo la cabecera', () => {
      // En Recepción la cola va a la izquierda, el formulario al centro y el
      // mapa abajo a la derecha: arriba a la derecha es lo único que no tapa
      // nada de lo que se mira mientras se habla.
      const p = posicionPorDefecto(PANTALLA);
      expect(p.x).toBe(1440 - 300 - 12);
      expect(p.y).toBe(78);
    });

    it('no se mete debajo de la cabecera', () => {
      expect(posicionPorDefecto(PANTALLA).y).toBeGreaterThanOrEqual(78);
    });

    it('en una ventana angosta sigue dentro de la pantalla', () => {
      const p = posicionPorDefecto({ ...PANTALLA, ventanaAncho: 320 });
      expect(p.x).toBeGreaterThanOrEqual(12);
      expect(p.x).toBeLessThanOrEqual(320);
    });
  });

  describe('acotar', () => {
    it('no deja que se salga por la derecha ni por abajo', () => {
      const p = acotar({ x: 5000, y: 5000 }, PANTALLA);
      expect(p.x).toBe(1440 - 300 - 12);
      expect(p.y).toBe(900 - 46 - 12);
    });

    it('ni por la izquierda ni por arriba, y deja margen para agarrarla', () => {
      const p = acotar({ x: -500, y: -500 }, PANTALLA);
      expect(p).toEqual({ x: 12, y: 12 });
    });

    it('una posición buena no se toca', () => {
      expect(acotar({ x: 400, y: 200 }, PANTALLA)).toEqual({ x: 400, y: 200 });
    });

    it('al desplegarse la barra crece y puede quedar medio cuerpo afuera', () => {
      // Plegada mide 46; desplegada, 360. La misma x deja de valer.
      const plegada = { ...PANTALLA, barraAncho: 46 };
      const pegadaALaDerecha = acotar({ x: 9999, y: 100 }, plegada);
      expect(pegadaALaDerecha.x).toBe(1440 - 46 - 12);

      const desplegada = acotar(pegadaALaDerecha, { ...PANTALLA, barraAncho: 360 });
      expect(desplegada.x).toBe(1440 - 360 - 12);
    });

    it('en una ventana más chica que la barra, al menos se ve el principio', () => {
      const p = acotar({ x: 100, y: 100 }, { ...PANTALLA, ventanaAncho: 200, ventanaAlto: 40 });
      expect(p).toEqual({ x: 12, y: 12 });
    });
  });

  describe('lo que se recuerda del puesto de trabajo', () => {
    beforeEach(() => localStorage.removeItem('falconcad_softphone_pos'));

    it('se guarda y se vuelve a leer', () => {
      guardarPosicion({ x: 300, y: 400 });
      expect(posicionGuardada()).toEqual({ x: 300, y: 400 });
    });

    it('sin nada guardado, no inventa una', () => {
      expect(posicionGuardada()).toBeNull();
    });

    it('una basura guardada no tumba la barra', () => {
      for (const basura of ['{roto', '{}', '{"x":"a","y":2}', 'null', '{"x":null,"y":1}']) {
        localStorage.setItem('falconcad_softphone_pos', basura);
        expect(posicionGuardada()).toBeNull();
      }
    });

    it('un infinito tampoco: dejaría la barra en ninguna parte', () => {
      localStorage.setItem('falconcad_softphone_pos', '{"x":1e999,"y":0}');
      expect(posicionGuardada()).toBeNull();
    });
  });
});
