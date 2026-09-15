import { EntityManager } from 'typeorm';
import { CasoCanalService } from './caso-canal.service';
import { CasoCanalEntity } from './caso-canal.entity';
import { CasoEntity } from './caso.entity';
import { EstadoCaso } from './caso.model';

/**
 * Los tres escenarios que motivaron el desacoplamiento, escritos tal como se
 * describieron: policía y bomberos atendiendo el mismo hecho.
 */
describe('CasoCanalService — independencia entre entidades', () => {
  const svc = new CasoCanalService();

  /** EntityManager de mentira: devuelve las filas dadas y recuerda lo que se guarda. */
  const managerCon = (filas: Array<Partial<CasoCanalEntity>>) => {
    const guardados: any[] = [];
    return {
      guardados,
      em: {
        getRepository: (entidad: any) => ({
          find: jest.fn().mockResolvedValue(filas),
          findOne: jest.fn().mockResolvedValue(filas[0] ?? null),
          save: jest.fn((v) => { guardados.push({ entidad: entidad?.name, v }); return Promise.resolve(v); }),
          create: jest.fn((v) => v),
        }),
      } as unknown as EntityManager,
    };
  };

  const fila = (estado: EstadoCaso, extra: Partial<CasoCanalEntity> = {}) =>
    ({ estado, actualizadoEn: new Date(), codigoCierre: null, ...extra }) as CasoCanalEntity;

  const caso = (estado: EstadoCaso) => ({ id: 'caso-1', estado }) as CasoEntity;

  it('policía toma el caso y para bomberos sigue estando sin tomar', async () => {
    // Policía avanzó; bomberos no lo ha abierto. El caso, globalmente, sigue
    // teniendo trabajo pendiente: manda el más atrasado.
    const { em } = managerCon([fila('en_gestion'), fila('nuevo')]);
    const c = caso('nuevo');

    const cambio = await svc.sincronizarMacro(em, 'demo', c);

    expect(c.estado).toBe('nuevo');
    expect(cambio).toBeNull();
  });

  it('policía cierra lo suyo y el caso NO se cierra mientras bomberos siga abierto', async () => {
    const { em } = managerCon([fila('cerrado'), fila('en_gestion')]);
    const c = caso('nuevo');

    await svc.sincronizarMacro(em, 'demo', c);

    // Lo que antes hacía desaparecer el caso de la bandeja de bomberos.
    expect(c.estado).not.toBe('cerrado');
    expect(c.estado).toBe('en_gestion');
  });

  it('solo cuando TODAS las entidades cierran, el caso pasa a cerrado', async () => {
    const { em } = managerCon([
      fila('cerrado', { codigoCierre: 'AT', actualizadoEn: new Date('2026-01-01T10:00:00Z') }),
      fila('cerrado', { codigoCierre: 'FA', actualizadoEn: new Date('2026-01-01T12:00:00Z') }),
    ]);
    const c = caso('en_gestion');

    const cambio = await svc.sincronizarMacro(em, 'demo', c);

    expect(c.estado).toBe('cerrado');
    expect(cambio).toEqual({ anterior: 'en_gestion', nuevo: 'cerrado' });
    // El desenlace es el de la última entidad en cerrar.
    expect(c.codigoCierre).toBe('FA');
  });

  it('un caso sin canales conserva su estado propio: no hay de dónde derivarlo', async () => {
    const { em } = managerCon([]);
    const c = caso('en_gestion');

    const cambio = await svc.sincronizarMacro(em, 'demo', c);

    expect(cambio).toBeNull();
    expect(c.estado).toBe('en_gestion');
  });

  it('despachar un recurso solo avanza la bandeja de la agencia dueña', async () => {
    const dePolicia = fila('en_gestion', { agenciaId: 'policia' });
    const { em, guardados } = managerCon([dePolicia]);

    const avanzo = await svc.avanzarAgencia(em, 'demo', 'caso-1', 'policia', 'despachado');

    expect(avanzo).toBe(true);
    expect(dePolicia.estado).toBe('despachado');
    expect(guardados.length).toBe(1);
  });

  it('no retrocede una bandeja que ya iba más adelante', async () => {
    // Una entidad que ya cerró no vuelve a "despachado" porque llegue otra unidad.
    const cerrada = fila('cerrado', { agenciaId: 'policia' });
    const { em } = managerCon([cerrada]);

    const avanzo = await svc.avanzarAgencia(em, 'demo', 'caso-1', 'policia', 'despachado');

    expect(avanzo).toBe(false);
    expect(cerrada.estado).toBe('cerrado');
  });
});
