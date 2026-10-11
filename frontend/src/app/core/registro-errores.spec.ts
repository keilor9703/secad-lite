import {
  MAXIMO,
  erroresRecientes,
  olvidarErrores,
  registrarErrorHttp,
  registrarErrorJs,
  soloRuta,
} from './registro-errores';

/**
 * Este registro se adjunta a tickets que SALEN del sistema: a un correo, a una
 * herramienta de mesa de ayuda, a un proveedor. Lo que se protege aquí no es
 * que el registro funcione —eso es lo fácil— sino que no se lleve nada que no
 * deba salir: la credencial de la sesión, el relato de la emergencia, el
 * teléfono del ciudadano.
 */
describe('registro de errores para soporte', () => {
  beforeEach(() => olvidarErrores());
  afterAll(() => olvidarErrores());

  it('anota método, ruta y estado de un rechazo HTTP', () => {
    registrarErrorHttp('post', '/api/casos', 500, { message: 'No se pudo guardar' });
    const [e] = erroresRecientes();
    expect(e.tipo).toBe('http');
    expect(e.que).toBe('POST /api/casos');
    expect(e.estado).toBe(500);
    expect(e.detalle).toBe('No se pudo guardar');
  });

  it('NO guarda la cadena de consulta: ahí viajan los datos del ciudadano', () => {
    registrarErrorHttp('GET', '/api/casos?telefono=3001234567&ciudadano=Ana%20Pérez', 403, null);
    const [e] = erroresRecientes();
    expect(e.que).toBe('GET /api/casos');
    expect(JSON.stringify(erroresRecientes())).not.toContain('3001234567');
    expect(JSON.stringify(erroresRecientes())).not.toContain('Ana');
  });

  it('descarta la consulta también en una URL absoluta', () => {
    expect(soloRuta('https://falconcad.com.co/api/llamadas?desde=3009999999')).toBe('/api/llamadas');
  });

  it('ninguna forma de URL deja pasar la consulta', () => {
    // Se afirma la GARANTÍA, no una cadena concreta: lo que importa es que de
    // ninguna de estas formas salga lo que venía después del `?`. Las dos
    // últimas son las que el navegador no sabe analizar ni con una base, y por
    // lo tanto las que ejercitan el recorte a mano.
    for (const url of [
      '/api/casos?clave=secreta',
      'https://falconcad.com.co/api/casos?clave=secreta',
      '::no es una url::?clave=secreta',
      'http://?clave=secreta',
      'http://[?clave=secreta',
    ]) {
      expect(soloRuta(url)).withContext(url).not.toContain('secreta');
      expect(soloRuta(url)).withContext(url).not.toContain('?');
    }
  });

  it('del cuerpo del error toma SOLO el mensaje, nunca el resto', () => {
    // Un 400 de Nest al crear un caso devuelve el cuerpo enviado en algunos
    // casos; serializarlo entero metería el relato y el teléfono en el ticket.
    registrarErrorHttp('POST', '/api/casos', 400, {
      message: 'La dirección es obligatoria',
      datos: { ciudadano: 'Ana Pérez', telefono: '3001234567', descripcion: 'Riña en la plaza' },
      token: 'ey.un.jwt',
    });
    const serializado = JSON.stringify(erroresRecientes());
    expect(serializado).toContain('La dirección es obligatoria');
    expect(serializado).not.toContain('Ana Pérez');
    expect(serializado).not.toContain('3001234567');
    expect(serializado).not.toContain('Riña');
    expect(serializado).not.toContain('ey.un.jwt');
  });

  it('acepta el mensaje en forma de arreglo (validación de Nest)', () => {
    registrarErrorHttp('POST', '/api/usuarios', 400, {
      message: ['la contraseña es muy corta', 'el usuario ya existe'],
    });
    expect(erroresRecientes()[0].detalle).toBe('la contraseña es muy corta · el usuario ya existe');
  });

  it('recorta los mensajes largos: un stack entero no cabe en un ticket', () => {
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'x'.repeat(5000) });
    expect(erroresRecientes()[0].detalle.length).toBeLessThanOrEqual(301);
  });

  it('no crece sin límite: el puesto de despacho no recarga en doce horas', () => {
    for (let i = 0; i < MAXIMO * 4; i++) registrarErrorHttp('GET', `/api/sondeo/${i}`, 0, null);
    const es = erroresRecientes();
    expect(es.length).toBe(MAXIMO);
    // Se conservan los ÚLTIMOS, que son los que explican lo que acaba de pasar.
    expect(es[es.length - 1].que).toBe(`GET /api/sondeo/${MAXIMO * 4 - 1}`);
  });

  it('un rechazo sin respuesta del servidor no queda mudo', () => {
    // Estado 0 es red caída o servidor apagado: el caso más frecuente y el que
    // más veces explica el reporte entero. El backend no pone mensaje, así que
    // si no lo pone el registro, el renglón sale vacío y no dice nada.
    registrarErrorHttp('GET', '/api/auth/perfil', 0, null);
    const [e] = erroresRecientes();
    expect(e.estado).toBe(0);
    expect(e.detalle).toBe('sin respuesta del servidor');
  });

  it('un fallo que se repite se cuenta, no barre el registro', () => {
    // El caso real: los trozos de la grabación de una videollamada se envían
    // cada pocos segundos. Con el backend rechazándolos, veinticinco renglones
    // idénticos expulsarían los errores que de verdad explican el problema.
    registrarErrorHttp('POST', '/api/video/1/chunk', 500, { message: 'disco lleno' });
    for (let i = 0; i < 60; i++) {
      registrarErrorHttp('POST', '/api/video/1/chunk', 500, { message: 'disco lleno' });
    }
    registrarErrorHttp('GET', '/api/casos', 403, { message: 'sin permiso' });

    const es = erroresRecientes();
    expect(es.length).toBe(2);
    expect(es[0].veces).toBe(61);
    // Y el error distinto, que es el que importa, sigue ahí.
    expect(es[1].que).toBe('GET /api/casos');
  });

  it('solo agrupa lo consecutivo: dos tandas separadas son dos renglones', () => {
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'a' });
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'a' });
    registrarErrorHttp('GET', '/api/otro', 500, { message: 'b' });
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'a' });
    const es = erroresRecientes();
    expect(es.map((e) => e.que)).toEqual(['GET /api/casos', 'GET /api/otro', 'GET /api/casos']);
    expect(es[0].veces).toBe(2);
    expect(es[2].veces).toBeUndefined();
  });

  it('un informe ya armado no cambia cuando el error se repite después', () => {
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'a' });
    const instantanea = erroresRecientes();
    registrarErrorHttp('GET', '/api/casos', 500, { message: 'a' });
    expect(instantanea[0].veces).toBeUndefined();
    expect(erroresRecientes()[0].veces).toBe(2);
  });

  it('anota una excepción de JavaScript con su nombre y su mensaje', () => {
    registrarErrorJs(new TypeError('no se puede leer la propiedad lat de null'));
    const [e] = erroresRecientes();
    expect(e.tipo).toBe('js');
    expect(e.que).toBe('TypeError');
    expect(e.detalle).toContain('propiedad lat');
  });

  it('aguanta cualquier cosa lanzada, no solo un Error', () => {
    expect(() => registrarErrorJs('un string pelado')).not.toThrow();
    expect(() => registrarErrorJs(undefined)).not.toThrow();
    expect(erroresRecientes().length).toBe(2);
    expect(erroresRecientes()[0].que).toBe('Error');
  });

  it('olvidar deja el registro vacío: el relevo no hereda el turno anterior', () => {
    registrarErrorHttp('GET', '/api/casos', 500, null);
    olvidarErrores();
    expect(erroresRecientes()).toEqual([]);
  });

  it('entrega una copia: nadie muta el registro desde fuera', () => {
    registrarErrorHttp('GET', '/api/casos', 500, null);
    erroresRecientes().push({ en: '', tipo: 'js', que: 'inventado', detalle: '' });
    expect(erroresRecientes().length).toBe(1);
  });
});
