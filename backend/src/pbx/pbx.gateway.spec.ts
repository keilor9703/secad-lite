import { LlamadaEvento } from './pbx.service';
import { LlamadaEntity } from './llamada.entity';
import { JwtPayload } from '../auth/auth.service';
import { esSupervisor, salasDelEvento } from './pbx.gateway';

/**
 * Quién se entera de qué llamada.
 *
 * El caso real: un usuario con extensión 103 veía, al oprimir F5, una llamada
 * dirigida a la extensión 110 — pero en vivo no le llegaba. La cola se veía
 * distinta antes y después de refrescar, porque el aviso en vivo y el listado
 * aplicaban reglas distintas.
 *
 * Equivocarse aquí no rompe nada visible: simplemente alguien deja de enterarse
 * de una llamada. En un CAD esa es la peor clase de error, y por eso la regla
 * vive en una función pura que se puede probar entera.
 */
const llamada = (destinatario: string | null): LlamadaEntity =>
  ({ id: 'l1', numero: '3175882321', destinatario } as LlamadaEntity);

const evento = (tipo: 'entrante' | 'cambio', destinatario: string | null): LlamadaEvento =>
  ({ tenant: 'itagui', tipo, llamada: llamada(destinatario) });

describe('salasDelEvento — a quién le llega el aviso en vivo', () => {
  it('dirigida a un funcionario: a SU puesto, no al de al lado', () => {
    const salas = salasDelEvento(evento('entrante', 'op110'));
    expect(salas).toContain('op:itagui:op110');
    expect(salas).not.toContain('op:itagui');
  });

  it('dirigida a un funcionario: también a la supervisión', () => {
    // Ya la veía al refrescar (listar se la devuelve para poder auxiliar un
    // puesto vacío). Sin esto, su cola cambiaba sola al oprimir F5.
    expect(salasDelEvento(evento('entrante', 'op110'))).toContain('sup:itagui');
  });

  it('SIN dirigir: a todo el tenant', () => {
    // Central sin ACD, extensión que no existe, o extensión de un funcionario
    // desactivado (buscarPorExtension solo resuelve los activos). Una llamada
    // sin dueño no puede quedarse sin que nadie la vea.
    expect(salasDelEvento(evento('entrante', null))).toEqual(['op:itagui']);
  });

  it('un cambio va a todo el tenant aunque esté dirigida', () => {
    // «Ya la tomaron» tiene que llegarle a todos, o los demás la seguirían
    // viendo timbrar y recibirían un 403 al intentar tomarla.
    expect(salasDelEvento(evento('cambio', 'op110'))).toEqual(['op:itagui']);
  });
});

describe('esSupervisor — la misma regla que aplica el listado', () => {
  const u = (rol: string, permisos: string[]): JwtPayload => ({ rol, permisos } as JwtPayload);

  it('el superadmin lo es', () => {
    expect(esSupervisor(u('superadmin', []))).toBe(true);
  });

  it('quien tiene casos.ver_todos lo es — por eso un Administrador lo es', () => {
    // El rol `admin` se siembra con TODOS los permisos, casos.ver_todos entre
    // ellos: de ahí que probando con una cuenta de administrador se vean las
    // llamadas de los demás puestos.
    expect(esSupervisor(u('admin', ['casos.ver', 'casos.ver_todos']))).toBe(true);
  });

  it('un operador no lo es', () => {
    expect(esSupervisor(u('operador', ['casos.ver', 'casos.crear', 'pbx.usar']))).toBe(false);
  });

  it('sin permisos en el token, no lo es', () => {
    expect(esSupervisor({ rol: 'operador' } as JwtPayload)).toBe(false);
  });
});
