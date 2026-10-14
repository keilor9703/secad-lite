import { ModuloNav, repartirModulos } from './shell';

/**
 * El reparto de las pestañas entre la barra y el menú «Más».
 *
 * Lo que de verdad se prueba aquí es la regla que no se ve mirando la pantalla:
 * el módulo en el que el usuario está parado NUNCA puede quedar escondido en el
 * menú. Sin ella, entrar a Monitor desde el menú dejaba la barra sin ninguna
 * pestaña marcada, y el usuario perdía la referencia de dónde está.
 */
describe('repartirModulos', () => {
  const mod = (etiqueta: string): ModuloNav => ({
    ruta: `/${etiqueta.toLowerCase()}`, mod: etiqueta.toLowerCase(),
    icono: 'panel', etiqueta,
  });
  const TODOS = ['Recepcion', 'Despacho', 'Consulta', 'Recursos', 'Panel', 'Mapa',
    'Catalogos', 'Admin', 'Plataforma', 'Monitor'].map(mod);
  const nombres = (ms: ModuloNav[]) => ms.map((m) => m.etiqueta);

  it('con espacio de sobra, no esconde nada', () => {
    expect(repartirModulos(TODOS, Number.POSITIVE_INFINITY, 0)).toEqual(TODOS);
    expect(repartirModulos(TODOS, 10, 0)).toEqual(TODOS);
    expect(repartirModulos(TODOS, 99, 0)).toEqual(TODOS);
  });

  it('cuando no caben todos, deja los primeros — que son los operativos', () => {
    expect(nombres(repartirModulos(TODOS, 5, 0)))
      .toEqual(['Recepcion', 'Despacho', 'Consulta', 'Recursos', 'Panel']);
  });

  it('si el módulo activo sí cabía, el orden no se toca', () => {
    expect(nombres(repartirModulos(TODOS, 5, 2)))
      .toEqual(['Recepcion', 'Despacho', 'Consulta', 'Recursos', 'Panel']);
  });

  it('si el módulo activo NO cabía, entra desplazando al último', () => {
    // Estoy en Monitor (índice 9) y solo caben cinco.
    const barra = nombres(repartirModulos(TODOS, 5, 9));
    expect(barra).toEqual(['Recepcion', 'Despacho', 'Consulta', 'Recursos', 'Monitor']);
    expect(barra.length).toBe(5, 'la barra no puede crecer para meterlo');
  });

  it('el activo queda SIEMPRE visible, cualquiera que sea y quepan los que quepan', () => {
    for (let caben = 1; caben <= TODOS.length; caben++) {
      for (let activo = 0; activo < TODOS.length; activo++) {
        const barra = repartirModulos(TODOS, caben, activo);
        expect(barra).toContain(TODOS[activo],
          `con caben=${caben} y activo=${activo} se perdió ${TODOS[activo].etiqueta}`);
        expect(barra.length).toBeLessThanOrEqual(caben);
      }
    }
  });

  it('ningún módulo se duplica ni se pierde entre la barra y el menú', () => {
    for (let caben = 0; caben <= TODOS.length; caben++) {
      for (const activo of [-1, 0, 4, 9]) {
        const barra = repartirModulos(TODOS, caben, activo);
        const enBarra = new Set(barra.map((m) => m.ruta));
        const menu = TODOS.filter((m) => !enBarra.has(m.ruta));
        expect(enBarra.size).toBe(barra.length, 'hay un repetido en la barra');
        expect(enBarra.size + menu.length).toBe(TODOS.length,
          `con caben=${caben} y activo=${activo} se perdió algún módulo`);
      }
    }
  });

  it('sin ningún módulo activo (una ruta fuera de la barra) se queda con los primeros', () => {
    expect(nombres(repartirModulos(TODOS, 3, -1))).toEqual(['Recepcion', 'Despacho', 'Consulta']);
  });

  it('aguanta los casos límite sin romperse', () => {
    expect(repartirModulos([], 0, -1)).toEqual([]);
    expect(repartirModulos([], Number.POSITIVE_INFINITY, -1)).toEqual([]);
    // Si no cabe ni una, no hay dónde meter el activo: la barra queda vacía y
    // todo se va al menú. Lo que no puede es petar ni inventar un elemento.
    expect(repartirModulos(TODOS, 0, 9)).toEqual([]);
    expect(nombres(repartirModulos(TODOS, 1, 9))).toEqual(['Monitor']);
  });
});
