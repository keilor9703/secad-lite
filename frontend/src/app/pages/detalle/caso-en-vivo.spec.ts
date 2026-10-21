import { Caso } from '../../core/models';
import { esDelCasoAbierto, fusionarCasoEnVivo } from './caso-en-vivo';

/**
 * LA FICHA ABIERTA SE ACTUALIZA SOLA.
 *
 * El defecto del 22/10/2026: el ciudadano mandó su ubicación por WhatsApp
 * mientras el operador tenía la ficha delante, y había que recargar la página
 * para verla. En una emergencia nadie recarga.
 */
describe('El caso abierto, en vivo', () => {
  const caso = (over: Partial<Caso> = {}): Caso =>
    ({
      id: 'caso-1', tenant: 'demo', canal: 'whatsapp',
      titulo: 'Incendio', descripcion: 'Incendio', ciudadano: 'Lina',
      agencia: 'Policía', estado: 'nuevo', prioridad: 'media',
      lat: null, lng: null, direccion: null,
      ...over,
    }) as unknown as Caso;

  it('la coordenada que llega entra en la ficha', () => {
    const abierto = caso();
    const llega = caso({ lat: 6.1845, lng: -75.5986, direccion: 'Calle 50' });

    const r = fusionarCasoEnVivo(abierto, llega);

    expect(r.lat).toBe(6.1845);
    expect(r.lng).toBe(-75.5986);
    expect(r.direccion).toBe('Calle 50');
  });

  it('el ESTADO que ya estaba no se pisa', () => {
    // En Despacho la ficha lleva el estado del CANAL que se está mirando; el
    // socket emite a todo el municipio y trae el macro-estado del caso.
    // Pisarlo movería la ficha de columna sin que nadie hiciera nada.
    const abierto = caso({ estado: 'en_gestion' });
    const llega = caso({ estado: 'cerrado', lat: 6.18, lng: -75.59 });

    const r = fusionarCasoEnVivo(abierto, llega);

    expect(r.estado).toBe('en_gestion');
    expect(r.lat).toBe(6.18); // y lo demás sí entra
  });

  it('sin ficha abierta todavía, se toma lo que llega tal cual', () => {
    const llega = caso({ estado: 'en_gestion' });
    expect(fusionarCasoEnVivo(null, llega)).toEqual(llega);
  });

  describe('qué cambios tocan la ficha abierta', () => {
    it('el del caso abierto, sí', () => {
      expect(esDelCasoAbierto(caso({ id: 'caso-1' }), 'caso-1')).toBe(true);
    });

    it('el de OTRO caso, no', () => {
      // El socket tiene una sola sala por municipio: aquí llega todo lo que
      // cambia en la instancia. Sin filtrar, la ficha de un operador se
      // reemplazaría por el caso de otro mientras lo está escribiendo.
      expect(esDelCasoAbierto(caso({ id: 'caso-9' }), 'caso-1')).toBe(false);
    });

    it('sin ficha abierta, ninguno', () => {
      expect(esDelCasoAbierto(caso(), null)).toBe(false);
    });
  });
});
