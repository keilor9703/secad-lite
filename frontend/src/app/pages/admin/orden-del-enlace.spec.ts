import {
  CAMINOS_DEL_ENLACE, FilaDeCamino, alternarCamino, filasDesde, moverCamino, ordenParaGuardar,
  sinNingunCamino, todosEnUso,
} from './orden-del-enlace';

/**
 * LA PANTALLA QUE DECIDE POR DÓNDE SALE EL ENLACE.
 *
 * Lo que se protege aquí: que lo guardado se pinte igual que está, que
 * reordenar no pierda ni duplique un camino, y que lo que se manda al
 * servidor sea exactamente lo que el administrador ve en la lista. Una
 * pantalla que guarda algo distinto de lo que muestra es peor que no tener la
 * opción.
 */
describe('filasDesde · de lo guardado a la pantalla', () => {
  it('sin configurar, «lo decide el sistema» y la lista en el orden automático', () => {
    // La lista NO queda vacía: al pasar a manual el administrador parte de lo
    // que hoy está pasando de verdad.
    const r = filasDesde(null);

    expect(r.auto).toBe(true);
    expect(r.filas.map((f) => f.canal)).toEqual(['whatsapp', 'plantilla', 'sms']);
    expect(r.filas.every((f) => f.usar)).toBe(true);
  });

  it('con un orden guardado, ese orden y «yo defino el orden»', () => {
    const r = filasDesde(['sms', 'plantilla', 'whatsapp']);

    expect(r.auto).toBe(false);
    expect(r.filas.map((f) => f.canal)).toEqual(['sms', 'plantilla', 'whatsapp']);
  });

  it('los caminos que quedaron fuera se pintan destildados y al final', () => {
    // Si no se pintaran, no habría forma de volver a activarlos: la pantalla
    // sería un camino de ida.
    const r = filasDesde(['sms']);

    expect(r.filas.map((f) => f.canal)).toEqual(['sms', 'whatsapp', 'plantilla']);
    expect(r.filas.map((f) => f.usar)).toEqual([true, false, false]);
  });

  it('nunca pierde un camino: los tres están siempre en la lista', () => {
    for (const guardado of [null, ['sms'], ['plantilla', 'sms'], ['whatsapp', 'plantilla', 'sms']]) {
      const filas = filasDesde(guardado as never).filas;
      expect(filas.length).toBe(CAMINOS_DEL_ENLACE.length);
      expect(new Set(filas.map((f) => f.canal)).size).toBe(CAMINOS_DEL_ENLACE.length);
    }
  });
});

describe('ordenParaGuardar · de la pantalla al servidor', () => {
  it('en automático se manda nulo, no una lista', () => {
    // Mandar la lista congelaría el orden por defecto de hoy en esa instancia.
    expect(ordenParaGuardar(true, todosEnUso())).toBeNull();
  });

  it('en manual se manda lo que se ve, en el orden en que se ve', () => {
    const filas: FilaDeCamino[] = [
      { canal: 'sms', usar: true },
      { canal: 'whatsapp', usar: true },
      { canal: 'plantilla', usar: true },
    ];

    expect(ordenParaGuardar(false, filas)).toEqual(['sms', 'whatsapp', 'plantilla']);
  });

  it('lo destildado no se manda', () => {
    const filas: FilaDeCamino[] = [
      { canal: 'sms', usar: false },
      { canal: 'whatsapp', usar: true },
      { canal: 'plantilla', usar: false },
    ];

    // Un municipio que no quiere pagar SMS no paga un SMS por accidente.
    expect(ordenParaGuardar(false, filas)).toEqual(['whatsapp']);
  });
});

describe('moverCamino', () => {
  const tres = (): FilaDeCamino[] => todosEnUso();

  it('sube y baja', () => {
    expect(moverCamino(tres(), 2, -1).map((f) => f.canal))
      .toEqual(['whatsapp', 'sms', 'plantilla']);
    expect(moverCamino(tres(), 0, 1).map((f) => f.canal))
      .toEqual(['plantilla', 'whatsapp', 'sms']);
  });

  it('en los extremos no hace nada, y sobre todo no pierde ni duplica', () => {
    // Intercambiar con un índice que no existe mete un `undefined` en la lista
    // y la pantalla pinta una fila vacía con un camino perdido.
    const arriba = moverCamino(tres(), 0, -1);
    const abajo = moverCamino(tres(), 2, 1);

    expect(arriba.map((f) => f.canal)).toEqual(['whatsapp', 'plantilla', 'sms']);
    expect(abajo.map((f) => f.canal)).toEqual(['whatsapp', 'plantilla', 'sms']);
    expect(arriba.every((f) => !!f)).toBe(true);
    expect(abajo.every((f) => !!f)).toBe(true);
  });

  it('conserva si cada camino estaba en uso', () => {
    const filas: FilaDeCamino[] = [
      { canal: 'whatsapp', usar: false },
      { canal: 'plantilla', usar: true },
      { canal: 'sms', usar: true },
    ];

    const movido = moverCamino(filas, 0, 1);

    expect(movido.map((f) => `${f.canal}:${f.usar}`))
      .toEqual(['plantilla:true', 'whatsapp:false', 'sms:true']);
  });

  it('no modifica la lista original', () => {
    // Las señales comparan por referencia: mutar en sitio no repinta.
    const original = tres();
    moverCamino(original, 0, 1);
    expect(original.map((f) => f.canal)).toEqual(['whatsapp', 'plantilla', 'sms']);
  });
});

describe('alternarCamino', () => {
  it('cambia solo el que se toca', () => {
    const r = alternarCamino(todosEnUso(), 'plantilla');
    expect(r.map((f) => f.usar)).toEqual([true, false, true]);
  });

  it('vuelve a activar lo destildado', () => {
    const r = alternarCamino(alternarCamino(todosEnUso(), 'sms'), 'sms');
    expect(r.every((f) => f.usar)).toBe(true);
  });
});

describe('sinNingunCamino · el aviso que evita el silencio', () => {
  it('avisa cuando se destildaron los tres', () => {
    let filas = todosEnUso();
    for (const c of ['whatsapp', 'plantilla', 'sms'] as const) filas = alternarCamino(filas, c);

    expect(sinNingunCamino(false, filas)).toBe(true);
  });

  it('con uno solo activo no avisa: es una elección legítima', () => {
    const filas = alternarCamino(alternarCamino(todosEnUso(), 'whatsapp'), 'plantilla');
    expect(sinNingunCamino(false, filas)).toBe(false);
  });

  it('en automático nunca avisa, aunque la lista esté toda destildada', () => {
    // En automático la lista no se manda: lo que haya en ella es irrelevante.
    const filas = todosEnUso().map((f) => ({ ...f, usar: false }));
    expect(sinNingunCamino(true, filas)).toBe(false);
  });
});
