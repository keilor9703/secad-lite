import { EstadoMapaGoogle, PLAZO_TESELAS_MS, hayQueCaerARespaldo } from './mapa-respaldo';

const base: EstadoMapaGoogle = { autenticacionFallo: false, teselasCargadas: false, plazoCumplido: false };
const con = (x: Partial<EstadoMapaGoogle>): EstadoMapaGoogle => ({ ...base, ...x });

/**
 * El fallo que esto cubre: el mapa de Google se cae DESPUÉS de que nuestro
 * código le entregue el control —«Esta página no cargó bien Google Maps»,
 * dentro del contenedor— y desde fuera parece que todo fue bien. El respaldo
 * de OpenStreetMap no se activaba y el operador se quedaba sin mapa alguno.
 */
describe('hayQueCaerARespaldo', () => {
  it('si Google rechazó la clave, se cae de inmediato: no hay nada que esperar', () => {
    expect(hayQueCaerARespaldo(con({ autenticacionFallo: true }))).toBeTrue();
  });

  it('si venció el plazo sin una sola tesela, se cae', () => {
    expect(hayQueCaerARespaldo(con({ plazoCumplido: true }))).toBeTrue();
  });

  it('NO se cae mientras el plazo corre: en un portátil con mala red las teselas tardan', () => {
    expect(hayQueCaerARespaldo(con({}))).toBeFalse();
  });

  it('si el mapa pintó, no se toca aunque venza el plazo', () => {
    // Cambiar de mapa debajo de un operador que ya está trabajando sería peor
    // que el problema que se intenta resolver.
    expect(hayQueCaerARespaldo(con({ teselasCargadas: true, plazoCumplido: true }))).toBeFalse();
  });

  it('haber pintado gana incluso a un fallo de autenticación posterior', () => {
    expect(hayQueCaerARespaldo(con({ teselasCargadas: true, autenticacionFallo: true }))).toBeFalse();
  });

  it('el plazo es holgado: ocho segundos sin una tesela no es lentitud', () => {
    expect(PLAZO_TESELAS_MS).toBeGreaterThanOrEqual(5_000);
  });
});
