import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Socket } from 'socket.io-client';
import { Injectable, signal } from '@angular/core';
import { PbxService, abonadoDeLlamada } from './pbx.service';
import { AuthService } from './auth.service';
import { Llamada, Sesion } from './models';

/**
 * La cola de llamadas tiene que ponerse al día sola.
 *
 * El caso real: un operador reportó que una llamada de la planta no aparecía
 * hasta oprimir F5. Socket.IO se reconecta solo, pero NO reenvía lo que emitió
 * mientras el cliente estuvo caído — y el hueco no es raro: una caída de red,
 * la pantalla suspendida, o un despliegue, que reinicia las tres réplicas una
 * por una y desconecta a todos los operadores. Sin volver a pedir la cola al
 * reconectar, la llamada que entró en ese hueco no aparece nunca.
 */

/** Doble del socket: deja disparar los eventos a mano. */
class SocketFalso {
  readonly manejadores = new Map<string, (dato: unknown) => void>();
  connected = false;

  on(evento: string, fn: (dato: unknown) => void): this {
    this.manejadores.set(evento, fn);
    return this;
  }
  disconnect(): this { this.connected = false; return this; }

  /** Lo que hace socket.io al establecer (o reestablecer) la conexión. */
  conectado(): void { this.connected = true; this.manejadores.get('connect')?.(undefined); }
  /**
   * `motivo` tal como lo entrega socket.io. 'transport close' es una caída de
   * red —de esas se reintenta solo—; 'io server disconnect' es el servidor
   * cerrando la conexión, y de esas NO.
   */
  caido(motivo = 'transport close'): void {
    this.connected = false;
    this.manejadores.get('disconnect')?.(motivo);
  }
  emitirAlCliente(evento: string, dato: unknown): void { this.manejadores.get(evento)?.(dato); }
}

/** PbxService con el socket sustituido por el doble. */
// @Injectable propio: heredarlo de la clase padre ya avisa de obsoleto y en
// una versión próxima de Angular será un error.
@Injectable()
class PbxServicePrueba extends PbxService {
  /** Un socket NUEVO por cada apertura, como en la vida real. */
  readonly abiertos: SocketFalso[] = [];
  get falso(): SocketFalso { return this.abiertos[this.abiertos.length - 1]; }

  /** Reaperturas pendientes, para dispararlas sin esperar en tiempo real. */
  readonly pendientes: Array<() => void> = [];

  protected override crearSocket(): Socket {
    const s = new SocketFalso();
    this.abiertos.push(s);
    return s as unknown as Socket;
  }
  // Solo se sustituye CUÁNDO: el qué (reabrirAhora) es el del servicio real.
  protected override reabrirMasTarde(_ms: number, reabrir: () => void): void {
    this.pendientes.push(reabrir);
  }
  /** Adelanta el reloj, de forma SÍNCRONA: así la aserción no corre antes. */
  correElTiempo(): void {
    const ps = this.pendientes.splice(0);
    for (const p of ps) p();
  }
}

/** Sesión de mentiras: lo único que mira PbxService es usuario, rol y permisos. */
function sesionDe(usuario: string, permisos: string[] = [], rol = 'operador') {
  return signal<Sesion | null>({ usuario, rol, permisos, token: 't', nombre: usuario, tipo: 'institucional', tenant: 'itagui' } as Sesion);
}

const LLAMADA: Llamada = {
  id: 'l-1', tenant: 'mebog', numero: '3175882321', origen: 'telefono',
  estado: 'sonando', creadoEn: '2026-10-04T10:00:00Z', actualizadoEn: '2026-10-04T10:00:00Z',
} as Llamada;

describe('PbxService — la cola se pone al día sola', () => {
  let pbx: PbxServicePrueba;
  let http: HttpTestingController;

  /** Responde a la petición de la cola; falla si no la hubo. */
  function responderCola(llamadas: Llamada[]): void {
    const req = http.expectOne((r) => r.url.endsWith('/pbx/llamadas'));
    req.flush(llamadas);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: PbxService, useClass: PbxServicePrueba },
      ],
    });
    pbx = TestBed.inject(PbxService) as PbxServicePrueba;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('al conectar pide la cola', () => {
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([LLAMADA]);
    expect(pbx.sonando().length).toBe(1);
  });

  it('AL RECONECTAR vuelve a pedirla: es lo que recupera lo perdido en el corte', () => {
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([]);
    expect(pbx.sonando().length).toBe(0);

    // Se cae el canal. Entra una llamada: el aviso se emite y se pierde,
    // porque este cliente no estaba.
    pbx.falso.caido();
    expect(pbx.enVivo()).withContext('se sabe que el canal está caído').toBe(false);

    // Vuelve el canal. Sin volver a preguntar, esa llamada no aparecería nunca.
    pbx.falso.conectado();
    responderCola([LLAMADA]);

    expect(pbx.sonando().length).withContext('la llamada del corte aparece sin F5').toBe(1);
    expect(pbx.sonando()[0].numero).toBe('3175882321');
    expect(pbx.enVivo()).toBe(true);
  });

  it('una llamada que llega por el canal en vivo entra sin pedir nada', () => {
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([]);

    pbx.falso.emitirAlCliente('llamada:entrante', LLAMADA);
    expect(pbx.sonando().length).toBe(1);
    expect(pbx.ultimaEntrante()?.id).toBe('l-1');
  });

  it('un cierre DEL SERVIDOR no deja el canal muerto: se vuelve a abrir', () => {
    // socket.io no reintenta tras un 'io server disconnect'. Sin reabrirlo a
    // mano, ese operador se queda sin aviso en vivo el resto de la jornada y
    // solo lo descubre oprimiendo F5.
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([]);
    expect(pbx.abiertos.length).toBe(1);

    pbx.falso.caido('io server disconnect');
    expect(pbx.enVivo()).toBe(false);

    pbx.correElTiempo();
    // La reapertura pide la cola de nuevo (conectar() lo hace de entrada).
    responderCola([]);
    expect(pbx.abiertos.length).withContext('se abrió un socket nuevo').toBe(2);

    pbx.falso.conectado();
    responderCola([LLAMADA]);
    expect(pbx.sonando().length).withContext('y la cola se puso al día').toBe(1);
    expect(pbx.enVivo()).toBe(true);
  });

  it('deja de insistir tras unos cuantos rechazos seguidos del servidor', () => {
    // Si el servidor rechaza el saludo porque la sesión ya no vale, insistir
    // para siempre no la revive: solo gasta red y esconde el problema. Al
    // agotarse, `enVivo` queda en falso y la pantalla lo dice.
    pbx.conectar();
    responderCola([]);

    // Ocho rechazos seguidos, más que el tope.
    for (let i = 0; i < 8; i++) {
      pbx.falso.caido('io server disconnect');
      pbx.correElTiempo();
      // Cada reapertura pide la cola; cuando ya no reabre, no hay petición.
      const pendientes = http.match((r) => r.url.endsWith('/pbx/llamadas'));
      for (const p of pendientes) p.flush([]);
    }

    expect(pbx.abiertos.length)
      .withContext('se abrieron el original más los reintentos del tope, y ni uno más')
      .toBe(1 + 5);
    expect(pbx.enVivo()).withContext('y la pantalla sabe que está sin canal').toBe(false);
  });

  it('una caída de red NO se reabre a mano: de esas socket.io se encarga solo', () => {
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([]);

    pbx.falso.caido('transport close');
    pbx.correElTiempo();
    expect(pbx.abiertos.length).withContext('no se duplica el socket').toBe(1);
    expect(pbx.enVivo()).toBe(false);
  });

  it('desconectar a propósito también apaga el indicador de canal vivo', () => {
    pbx.conectar();
    responderCola([]);
    pbx.falso.conectado();
    responderCola([]);
    expect(pbx.enVivo()).toBe(true);

    pbx.desconectar();
    expect(pbx.enVivo()).toBe(false);
  });
});

/**
 * Ver una llamada y que le suene a uno no son lo mismo.
 *
 * El caso real: con una cuenta de Administrador (que lleva `casos.ver_todos`)
 * aparecía en la cola una llamada dirigida a OTRA extensión. Eso es deliberado
 * —la supervisión ve toda la cola para poder auxiliar un puesto vacío— pero el
 * timbre no debe sonarle: un aviso que suena siempre deja de avisar.
 */
describe('PbxService — ver no es sonar', () => {
  const AJENA = { ...LLAMADA, id: 'l-2', destinatario: 'op110' } as Llamada;
  const SIN_DUENO = { ...LLAMADA, id: 'l-3', destinatario: null } as Llamada;

  function montar(usuario: string, permisos: string[]) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { sesion: sesionDe(usuario, permisos), token: 't', tenantActivo: () => 'itagui' } },
        { provide: PbxService, useClass: PbxServicePrueba },
      ],
    });
    return {
      pbx: TestBed.inject(PbxService) as PbxServicePrueba,
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('al operador de otro puesto no le aparece la llamada dirigida a la 110', () => {
    const { pbx, http } = montar('op103', ['casos.ver', 'pbx.usar']);
    pbx.conectar();
    http.expectOne((r) => r.url.endsWith('/pbx/llamadas')).flush([AJENA]);
    expect(pbx.sonando().length).toBe(0);
    http.verify();
  });

  it('a la supervisión sí le aparece, para poder auxiliar ese puesto', () => {
    const { pbx, http } = montar('jefe', ['casos.ver', 'casos.ver_todos']);
    pbx.conectar();
    http.expectOne((r) => r.url.endsWith('/pbx/llamadas')).flush([AJENA]);
    expect(pbx.sonando().length).toBe(1);
    http.verify();
  });

  it('pero no es suya: no le suena', () => {
    const { pbx, http } = montar('jefe', ['casos.ver', 'casos.ver_todos']);
    pbx.conectar();
    http.expectOne((r) => r.url.endsWith('/pbx/llamadas')).flush([]);
    expect(pbx.esMia(AJENA)).withContext('no es suya').toBe(false);
    expect(pbx.esMia(SIN_DUENO)).withContext('una sin dueño sí le toca').toBe(true);
    http.verify();
  });

  it('una llamada sin dueño le aparece a cualquier operador', () => {
    // Central sin ACD, extensión inexistente, o extensión de un funcionario
    // desactivado: no puede quedarse sin que nadie la vea.
    const { pbx, http } = montar('op103', ['casos.ver', 'pbx.usar']);
    pbx.conectar();
    http.expectOne((r) => r.url.endsWith('/pbx/llamadas')).flush([SIN_DUENO]);
    expect(pbx.sonando().length).toBe(1);
    expect(pbx.esMia(SIN_DUENO)).toBe(true);
    http.verify();
  });

  it('y la suya le aparece y es suya', () => {
    const mia = { ...LLAMADA, id: 'l-4', destinatario: 'op103' } as Llamada;
    const { pbx, http } = montar('op103', ['casos.ver', 'pbx.usar']);
    pbx.conectar();
    http.expectOne((r) => r.url.endsWith('/pbx/llamadas')).flush([mia]);
    expect(pbx.sonando().length).toBe(1);
    expect(pbx.esMia(mia)).toBe(true);
    http.verify();
  });
});

/**
 * Lo que manda la central no siempre es un abonado.
 *
 * Visto en producción (`pbx_webhook_log`): para los contactos de WhatsApp manda
 * `+CO.1744934636794102`, un identificador de sesión. Escribirlo en el campo
 * Abonado haría que el operador marcara un número que no existe, o que quedara
 * guardado en el caso como el teléfono del ciudadano.
 */
describe('PbxService.esNumeroMarcable', () => {
  it('acepta lo que es un abonado', () => {
    expect(PbxService.esNumeroMarcable('3175882321')).toBe(true);
    expect(PbxService.esNumeroMarcable('+573175882321')).toBe(true);
    expect(PbxService.esNumeroMarcable('03133958748')).toBe(true);
  });

  it('rechaza el identificador de la central', () => {
    expect(PbxService.esNumeroMarcable('+CO.1744934636794102')).toBe(false);
  });

  it('rechaza lo que no cabe en un plan de numeración', () => {
    expect(PbxService.esNumeroMarcable('12345')).toBe(false);
    expect(PbxService.esNumeroMarcable('')).toBe(false);
    expect(PbxService.esNumeroMarcable(null)).toBe(false);
  });
});

/**
 * Qué queda en el campo Abonado al tomar una llamada.
 *
 * Un número inventado en ese campo no es un detalle cosmético: se marca, se
 * guarda en el caso como el teléfono del ciudadano, y se cruza contra otros
 * casos del mismo número.
 */
describe('abonadoDeLlamada', () => {
  it('un abonado de verdad se escribe tal cual', () => {
    expect(abonadoDeLlamada('3175882321')).toEqual({ abonado: '3175882321', aviso: '' });
  });

  it('el identificador de la central SÍ se escribe: es el único rastro del contacto', () => {
    // Vaciar el campo perdía lo único que ata el caso con quien llamó. Se
    // escribe, pero con la advertencia de que no es un teléfono.
    const r = abonadoDeLlamada('+CO.4552575428314811');
    expect(r.abonado).withContext('no se pierde').toBe('+CO.4552575428314811');
    expect(r.aviso).toContain('no envió el número');
    expect(r.aviso).withContext('se muestra qué mandó, para poder rastrearlo').toContain('+CO.4552575428314811');
  });

  it('y el operador sabe qué hacer: preguntárselo al ciudadano', () => {
    expect(abonadoDeLlamada('+CO.4552575428314811').aviso).toContain('Pregúnteselo');
  });
});
