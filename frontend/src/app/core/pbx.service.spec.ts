import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Socket } from 'socket.io-client';
import { PbxService } from './pbx.service';
import { Llamada } from './models';

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
