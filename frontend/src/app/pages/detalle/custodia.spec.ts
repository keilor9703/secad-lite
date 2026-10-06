import { cuerpoDeError, leerCustodia } from './custodia';

/**
 * La distinción que protege esto: «está guardada, pídela» NO es lo mismo que
 * «no se pudo descargar». Si se confunden, o el operador cree que la grabación
 * se perdió, o el administrador se pasa la tarde buscando en la NAS un archivo
 * que nunca existió.
 */
describe('leerCustodia', () => {
  it('reconoce el aviso del backend y saca el nombre que hay que pedir', () => {
    expect(leerCustodia({ motivo: 'EN_CUSTODIA', archivo: '2026/10/abc.webm', sha256: 'a'.repeat(64) }))
      .toEqual({ archivo: '2026/10/abc.webm', sha256: 'a'.repeat(64) });
  });

  it('un fallo cualquiera NO se disfraza de custodia', () => {
    expect(leerCustodia({ statusCode: 500, message: 'Internal Server Error' })).toBeNull();
    expect(leerCustodia({ motivo: 'OTRA_COSA', archivo: 'x.webm' })).toBeNull();
  });

  it('sin nombre de archivo no sirve de nada: no hay qué pedir', () => {
    expect(leerCustodia({ motivo: 'EN_CUSTODIA', archivo: '   ' })).toBeNull();
    expect(leerCustodia({ motivo: 'EN_CUSTODIA' })).toBeNull();
  });

  it('el sha256 es opcional: su falta no anula el aviso', () => {
    expect(leerCustodia({ motivo: 'EN_CUSTODIA', archivo: 'x.webm' }))
      .toEqual({ archivo: 'x.webm', sha256: null });
  });

  it('no revienta con basura', () => {
    for (const c of [null, undefined, '', 0, [], 'texto']) {
      expect(leerCustodia(c)).toBeNull();
    }
  });
});

describe('cuerpoDeError', () => {
  it('lee el JSON cuando el error vino como Blob', async () => {
    // La descarga pide `responseType: blob`, así que el cuerpo del error
    // también llega como Blob. Sin esto el aviso nunca se leería.
    const blob = new Blob([JSON.stringify({ motivo: 'EN_CUSTODIA', archivo: 'x.webm' })],
      { type: 'application/json' });
    expect(leerCustodia(await cuerpoDeError(blob))).toEqual({ archivo: 'x.webm', sha256: null });
  });

  it('un Blob que no es JSON no revienta', async () => {
    expect(await cuerpoDeError(new Blob(['<html>502</html>']))).toBeNull();
  });

  it('un cuerpo que ya es objeto pasa tal cual', async () => {
    const o = { motivo: 'EN_CUSTODIA', archivo: 'y.webm' };
    expect(await cuerpoDeError(o)).toBe(o);
  });
});
