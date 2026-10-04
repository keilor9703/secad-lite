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
  caido(): void { this.connected = false; this.manejadores.get('disconnect')?.(undefined); }
  emitirAlCliente(evento: string, dato: unknown): void { this.manejadores.get(evento)?.(dato); }
}

/** PbxService con el socket sustituido por el doble. */
class PbxServicePrueba extends PbxService {
  readonly falso = new SocketFalso();
  protected override crearSocket(): Socket { return this.falso as unknown as Socket; }
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
