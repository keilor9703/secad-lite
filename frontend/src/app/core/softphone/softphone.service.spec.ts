import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { SoftphoneService } from './softphone.service';
import { TransporteSipJs } from './transporte-sipjs';
import { ConfigSoftphone, OyentesSip } from './transporte-sip';
import { PbxService } from '../pbx.service';
import { AuthService } from '../auth.service';
import { Llamada } from '../models';

/** Un teléfono de mentira: guarda los oyentes para poder provocar los avisos. */
class TransporteFalso {
  oyentes?: OyentesSip;
  config?: ConfigSoftphone;
  contestadas = 0;
  colgadas = 0;
  silencios: boolean[] = [];
  tonos: string[] = [];

  async conectar(config: ConfigSoftphone, oyentes: OyentesSip): Promise<void> {
    this.config = config;
    this.oyentes = oyentes;
    oyentes.registro('registrado');
  }
  async desconectar(): Promise<void> { this.oyentes = undefined; }
  async contestar(): Promise<void> { this.contestadas += 1; }
  async colgar(): Promise<void> { this.colgadas += 1; }
  silenciar(s: boolean): void { this.silencios.push(s); }
  async tono(t: string): Promise<void> { this.tonos.push(t); }
  usarAudio(): void { /* no hace falta en pruebas */ }
}

const llamada = (over: Partial<Llamada> = {}): Llamada => ({
  id: 'l-1', tenant: 'itagui', numero: '3001234567', origen: 'telefono', estado: 'sonando',
  creadoEn: '2026-10-15T10:00:00Z', actualizadoEn: '2026-10-15T10:00:00Z', ...over,
} as Llamada);

/**
 * CONTESTAR DENTRO DE FALCON.
 *
 * Nada de lo que se prueba aquí es SIP: es lo que FALCON decide. Y lo que
 * decide es una cosa difícil — reconocer que la llamada que suena en el
 * navegador y la que está en la cola del servidor son la misma, habiendo
 * llegado por caminos distintos (SIP al navegador, webhook al servidor).
 */
describe('SoftphoneService', () => {
  let sp: SoftphoneService;
  let transporte: TransporteFalso;
  let http: HttpTestingController;
  let llamadas: ReturnType<typeof signal<Llamada[]>>;
  let paraTrabajar: ReturnType<typeof signal<Llamada | null>>;
  let reclamar: jasmine.Spy;
  let capacidades: string[];
  /** Lo que contesta el servidor cuando se le vuelve a preguntar la cola. */
  let alRecargar: () => Llamada[] | null;
  let recargas: number;

  const CONFIG: ConfigSoftphone = {
    wss: 'wss://wss.ejemplo.com', dominio: 'sip.ejemplo.com',
    // El usuario SIP y la extensión son cosas distintas: en Zadarma la 102 se
    // registra como «598703-102».
    usuario: '598703-102', extension: '102', clave: 's3cr3t0',
  };

  beforeEach(() => {
    transporte = new TransporteFalso();
    llamadas = signal<Llamada[]>([]);
    paraTrabajar = signal<Llamada | null>(null);
    capacidades = ['entrantes', 'softphone'];
    reclamar = jasmine.createSpy('reclamar').and.callFake((id: string) => of(llamada({ id, destinatario: 'pedro' })));
    recargas = 0;
    alRecargar = () => llamadas();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: TransporteSipJs, useValue: transporte },
        {
          provide: PbxService,
          useValue: {
            llamadas, paraTrabajar, reclamar,
            puede: (c: string) => capacidades.includes(c),
            recargarYEsperar: async () => {
              recargas += 1;
              const v = alRecargar();
              if (v) llamadas.set(v);
              return v;
            },
          },
        },
        {
          provide: AuthService,
          useValue: {
            tieneIntegracion: () => true,
            tienePermiso: () => true,
            sesion: () => ({ usuario: 'pedro' }),
          },
        },
      ],
    });
    sp = TestBed.inject(SoftphoneService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Enciende el teléfono respondiendo a la petición de configuración. */
  async function encender(
    r: { disponible: boolean; config?: ConfigSoftphone; motivo?: string } =
      { disponible: true, config: CONFIG },
  ): Promise<void> {
    const promesa = sp.encender();
    http.expectOne((req) => req.url.endsWith('/pbx/softphone')).flush(r);
    await promesa;
  }

  describe('encender', () => {
    it('se registra con la configuración que entrega el servidor', async () => {
      await encender();

      expect(sp.estado()).toBe('registrado');
      expect(transporte.config).toEqual(CONFIG);
      expect(sp.motivo()).toBe('');
    });

    it('si no está disponible, NO se intenta registrar y se dice por qué', async () => {
      // Registrarse contra una dirección vacía da un error de WebSocket que
      // nadie puede interpretar; el motivo del servidor sí se entiende.
      await encender({ disponible: false, motivo: 'Falta la clave SIP de la extensión 102.' });

      expect(sp.estado()).toBe('apagado');
      expect(sp.motivo()).toContain('clave SIP');
      expect(transporte.config).toBeUndefined();
    });

    it('dos veces no abre dos registros', async () => {
      await encender();
      await sp.encender();
      http.verify();
      expect(sp.estado()).toBe('registrado');
    });

    it('apagar deja todo en cero', async () => {
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });

      await sp.apagar();

      expect(sp.estado()).toBe('apagado');
      expect(sp.entrante()).toBeNull();
      expect(sp.enCurso()).toBeNull();
      expect(sp.avisoCola()).toBe('');
    });
  });

  describe('atar la llamada del navegador con la de la cola', () => {
    it('por MI EXTENSIÓN, que es la señal más fuerte y la que siempre está', async () => {
      // Lo encontró la primera prueba real: la central mandó la llamada
      // interna sin `caller_id`, la cola mostró «Sin número» y casar por
      // número no tenía con qué. Pero la cola SÍ sabía a qué extensión la
      // dirigió, y este navegador está registrado como esa extensión.
      llamadas.set([llamada({ id: 'l-9', numero: '', extension: '102' })]);
      await encender();

      expect(sp.deLaCola({ numero: '' })?.id).toBe('l-9');
    });

    it('una llamada dirigida a OTRA extensión no es mía', async () => {
      llamadas.set([llamada({ id: 'l-otra', numero: '', extension: '103' })]);
      await encender();

      expect(sp.deLaCola({ numero: '' })).toBeNull();
    });

    it('por número, normalizado igual que en el servidor', async () => {
      // La central manda el `From` crudo; la cola guarda el normalizado.
      // Comparar uno contra otro sin normalizar no casa nunca.
      llamadas.set([llamada({ id: 'l-9', numero: '+573001234567' })]);
      await encender();

      expect(sp.deLaCola({ numero: '+57 300 123 4567' })?.id).toBe('l-9');
    });

    it('por identificador de la central, cuando lo manda: es exacto', async () => {
      llamadas.set([
        llamada({ id: 'l-1', numero: '3001111111', callId: 'in-1' }),
        llamada({ id: 'l-2', numero: '3002222222', callId: 'in-2' }),
      ]);
      await encender();

      expect(sp.deLaCola({ numero: '3001111111', callId: 'in-2' })?.id).toBe('l-2');
    });

    it('entre varias a MI extensión, prefiere la que ya es suya', async () => {
      llamadas.set([
        llamada({ id: 'l-otra', numero: '', extension: '102', destinatario: 'ana' }),
        llamada({ id: 'l-mia', numero: '', extension: '102', destinatario: 'pedro' }),
      ]);
      await encender();

      expect(sp.deLaCola({ numero: '' })?.id).toBe('l-mia');
    });

    it('entre varias del MISMO número, prefiere la dirigida a este operador', async () => {
      // Pasa de verdad: dos personas llamando desde la misma cabina o el
      // mismo conmutador. Tomar la del compañero le quita la suya.
      llamadas.set([
        llamada({ id: 'l-otro', destinatario: 'ana' }),
        llamada({ id: 'l-mia', destinatario: 'pedro' }),
      ]);
      await encender();

      expect(sp.deLaCola({ numero: '3001234567' })?.id).toBe('l-mia');
    });

    it('si ninguna es suya, prefiere una sin dueño antes que la de otro', async () => {
      llamadas.set([llamada({ id: 'l-otro', destinatario: 'ana' }), llamada({ id: 'l-libre' })]);
      await encender();

      expect(sp.deLaCola({ numero: '3001234567' })?.id).toBe('l-libre');
    });

    it('no casa con una llamada que ya no está sonando', async () => {
      llamadas.set([llamada({ estado: 'finalizada' })]);
      await encender();

      expect(sp.deLaCola({ numero: '3001234567' })).toBeNull();
    });

    it('sin número no inventa un emparejamiento', async () => {
      llamadas.set([llamada()]);
      await encender();

      expect(sp.deLaCola({ numero: '' })).toBeNull();
    });
  });

  describe('contestar: un solo gesto', () => {
    it('acepta el audio Y toma la llamada de la cola para este operador', async () => {
      llamadas.set([llamada({ id: 'l-7' })]);
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });

      await sp.contestar();

      expect(transporte.contestadas).toBe(1);
      expect(reclamar).toHaveBeenCalledOnceWith('l-7');
      // Y queda el traspaso para que Recepción llene el formulario.
      expect(paraTrabajar()?.id).toBe('l-7');
      expect(sp.avisoCola()).toContain('Recepción');
    });

    it('el audio va PRIMERO: el ciudadano está esperando', async () => {
      // Si tomar la llamada en la cola falla, la conversación ya está en pie.
      llamadas.set([llamada({ id: 'l-7' })]);
      reclamar.and.returnValue(throwError(() => ({ error: { message: 'La llamada ya no está en cola.' } })));
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });

      await sp.contestar();

      expect(transporte.contestadas).toBe(1);
      expect(sp.avisoCola()).toContain('Contestada');
      expect(sp.avisoCola()).toContain('ya no está en cola');
      expect(paraTrabajar()).toBeNull();
    });

    it('no espera al servidor para aceptar el audio', async () => {
      // Lo encontró un sabotaje: la prueba de arriba seguía pasando con el
      // orden invertido, porque buscar en la cola es inmediato. Lo que de
      // verdad hay que garantizar es que contestar NO queda a merced de una
      // petición: con el servidor colgado, el ciudadano no puede quedarse
      // esperando a que alguien conteste.
      llamadas.set([llamada({ id: 'l-7' })]);
      reclamar.and.returnValue({ subscribe: () => undefined });
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });

      await sp.contestar();

      expect(transporte.contestadas).toBe(1);
    });

    it('con la cola VACÍA, dice que la central no le avisa a esta instancia', async () => {
      // Es otra cosa, y mandarlo a revisar el emparejamiento sería mandarlo
      // a buscar donde no está: la dirección del webhook lleva la API key de
      // UNA instancia, así que una cuenta de la centralita entrega sus
      // llamadas a una sola.
      llamadas.set([]);
      await encender();
      transporte.oyentes!.entrante({ numero: '3009999999' });

      await sp.contestar();

      expect(transporte.contestadas).toBe(1);
      expect(reclamar).not.toHaveBeenCalled();
      expect(sp.avisoCola()).toContain('API key de ESTA instancia');
    });

    it('con cola pero sin coincidencia, dice eso otro', async () => {
      llamadas.set([llamada({ id: 'l-ajena', numero: '3001111111', extension: '199' })]);
      await encender();
      transporte.oyentes!.entrante({ numero: '3009999999' });

      await sp.contestar();

      expect(sp.avisoCola()).toContain('ninguna de las llamadas que están timbrando');
      expect(sp.avisoCola()).not.toContain('API key');
    });

    it('sin llamada entrante no hace nada', async () => {
      await encender();
      await sp.contestar();
      expect(transporte.contestadas).toBe(0);
    });
  });

  describe('cuando la llamada no está en la cola que uno tiene en memoria', () => {
    /** Contesta una llamada entrante de ese número. */
    async function contestarEntrante(numero = '3001234567'): Promise<void> {
      await encender();
      transporte.oyentes!.entrante({ numero });
      await sp.contestar();
    }

    it('se le vuelve a preguntar al servidor, y ahí sí se empareja', async () => {
      // La cola en memoria la llena Socket.IO, y ese canal tiene huecos: una
      // red que se cayó, la pantalla suspendida, un despliegue que reinicia
      // las réplicas. Con la copia vieja se concluía «la central no le avisa a
      // esta instancia» y eso manda media hora al panel de la centralita por
      // un aviso que este navegador se perdió.
      llamadas.set([]);
      alRecargar = () => [llamada({ id: 'l-9', estado: 'sonando' })];

      await contestarEntrante();

      expect(recargas).toBe(1);
      expect(reclamar).toHaveBeenCalledWith('l-9');
    });

    it('si ya estaba en memoria, no se le pregunta al servidor', async () => {
      // Pedirle la cola en cada llamada contestada sería una petición de más
      // en el momento de más prisa.
      llamadas.set([llamada({ id: 'l-1', estado: 'sonando' })]);

      await contestarEntrante();

      expect(recargas).toBe(0);
      expect(reclamar).toHaveBeenCalledWith('l-1');
    });

    it('si hay otras timbrando y ninguna es esta, se habla de la extensión', async () => {
      alRecargar = () => [llamada({ id: 'l-2', numero: '3119998888', estado: 'sonando' })];

      await contestarEntrante('3001234567');

      expect(sp.avisoCola()).toContain('ninguna de las llamadas que están timbrando');
      expect(sp.avisoCola()).toContain('extensión');
      expect(reclamar).not.toHaveBeenCalled();
    });

    it('si hay historial pero nada timbrando, el webhook SÍ llega y se dice', async () => {
      // Esta distinción es la que evita cambiar una API key que estaba bien:
      // si hay llamadas anteriores, la llave de la URL es la correcta y lo
      // que no llegó es el aviso de ESTA llamada.
      alRecargar = () => [llamada({ id: 'l-3', estado: 'atendida' })];

      await contestarEntrante();

      expect(sp.avisoCola()).toContain('SÍ le llegan');
      expect(sp.avisoCola()).toContain('pbx_webhook_log');
    });

    it('si la cola está vacía del todo, se señala la API key del webhook', async () => {
      alRecargar = () => [];

      await contestarEntrante();

      expect(sp.avisoCola()).toContain('API key de ESTA instancia');
    });

    it('si no se pudo preguntar, se dice eso y no se culpa a nadie', async () => {
      // «No sé» y «no hay nada» no son lo mismo. Decir que la cola está vacía
      // cuando el servidor no contestó es inventarse un diagnóstico.
      alRecargar = () => null;

      await contestarEntrante();

      expect(sp.avisoCola()).toContain('no se pudo consultar');
      expect(sp.avisoCola()).not.toContain('API key');
    });

    it('el audio va primero: ya estaba contestada antes de mirar la cola', async () => {
      // El ciudadano está al teléfono. Si tomar la llamada en la cola falla
      // —o si hay que preguntarle la cola al servidor, que tarda—, la
      // conversación ya tiene que estar en pie. Un diagnóstico no puede
      // costar la llamada.
      let contestadasAlPreguntar = -1;
      alRecargar = () => { contestadasAlPreguntar = transporte.contestadas; return null; };

      await contestarEntrante();

      expect(contestadasAlPreguntar).toBe(1);
      expect(sp.avisoCola()).toContain('no se pudo consultar');
    });
  });

  describe('el timbre y el audio', () => {
    it('una llamada entrando enciende el timbre, y contestar lo calla', async () => {
      // Un teléfono que no suena no es un teléfono: en una sala de despacho
      // el operador está mirando el mapa, no la esquina de la barra.
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });
      expect((sp as unknown as { timbre: { sonando(): boolean } }).timbre.sonando()).toBeTrue();

      await sp.contestar();
      expect((sp as unknown as { timbre: { sonando(): boolean } }).timbre.sonando()).toBeFalse();
    });

    it('rechazar también lo calla, y antes de que la red responda', async () => {
      // Un timbre que sigue sonando después de rechazar es lo que hace que
      // alguien le baje el volumen al equipo y se pierda la siguiente.
      await encender();
      transporte.oyentes!.entrante({ numero: '300' });

      await sp.colgar();

      expect((sp as unknown as { timbre: { sonando(): boolean } }).timbre.sonando()).toBeFalse();
    });

    it('si no llega audio de la otra parte, se dice', async () => {
      // Pasó en producción: la llamada en pie, al operador lo oían, y él no
      // oía nada. El silencio no se distingue de «todavía no ha dicho nada»
      // hasta que es tarde.
      await encender();
      transporte.oyentes!.entrante({ numero: '300' });
      transporte.oyentes!.establecida(0);

      expect(sp.sinAudioRemoto()).toBeTrue();
    });

    it('y con audio, no se dice nada', async () => {
      await encender();
      transporte.oyentes!.entrante({ numero: '300' });
      transporte.oyentes!.establecida(1);

      expect(sp.sinAudioRemoto()).toBeFalse();
    });

    it('si el audio llega tarde, el aviso se retracta y la llamada sigue ahí', async () => {
      // El flujo remoto de SIP.js nace sin pistas, así que el aviso puede
      // llegar antes que el audio. Un aviso que no se retracta hace que la
      // segunda vez nadie le crea — y, peor, corregirlo mal borraba la
      // llamada de la barra con el ciudadano al otro lado.
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });
      transporte.oyentes!.establecida(0);
      expect(sp.sinAudioRemoto()).toBeTrue();

      transporte.oyentes!.establecida(1);

      expect(sp.sinAudioRemoto()).toBeFalse();
      expect(sp.enCurso()).not.toBeNull();
      expect(sp.entrante()).toBeNull();
    });

    it('el acuse de la cola desaparece al colgar', async () => {
      // "Tomada para usted" es feedback del momento. Al colgar ya no dice
      // nada, y colgando debajo de una barra plegada se ve roto.
      llamadas.set([llamada({ id: 'l-1', estado: 'sonando' })]);
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });
      await sp.contestar();
      expect(sp.avisoCola()).toContain('Tomada para usted');

      transporte.oyentes!.terminada();

      expect(sp.avisoCola()).toBe('');
    });

    it('pero el DIAGNÓSTICO sobrevive al cuelgue', async () => {
      // Las llamadas son cortas. Un «la cola de esta instancia está vacía»
      // que se borra al colgar es un aviso que el operador puede no alcanzar
      // a leer nunca — y es justo el que hay que atender.
      alRecargar = () => [];
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });
      await sp.contestar();
      expect(sp.avisoCola()).toContain('API key de ESTA instancia');

      transporte.oyentes!.terminada();

      expect(sp.avisoCola()).toContain('API key de ESTA instancia');
    });

    it('y la siguiente llamada sí lo borra', async () => {
      alRecargar = () => [];
      await encender();
      transporte.oyentes!.entrante({ numero: '3001234567' });
      await sp.contestar();
      transporte.oyentes!.terminada();

      transporte.oyentes!.entrante({ numero: '3009999999' });

      expect(sp.avisoCola()).toBe('');
    });

    it('al terminar la llamada se olvida el aviso', async () => {
      await encender();
      transporte.oyentes!.entrante({ numero: '300' });
      transporte.oyentes!.establecida(0);
      transporte.oyentes!.terminada();

      expect(sp.sinAudioRemoto()).toBeFalse();
    });
  });

  describe('el estado que ve la pantalla', () => {
    it('entrante → en curso → terminada', async () => {
      await encender();

      transporte.oyentes!.entrante({ numero: '3001234567' });
      expect(sp.entrante()?.numero).toBe('3001234567');
      expect(sp.enCurso()).toBeNull();

      transporte.oyentes!.establecida(1);
      expect(sp.entrante()).toBeNull();
      expect(sp.enCurso()?.numero).toBe('3001234567');

      transporte.oyentes!.terminada();
      expect(sp.enCurso()).toBeNull();
      expect(sp.silenciado()).toBeFalse();
    });

    it('un fallo del registro se muestra con su motivo', async () => {
      await encender();
      transporte.oyentes!.registro('fallo', 'Se perdió la conexión con la centralita.');

      expect(sp.estado()).toBe('fallo');
      expect(sp.motivo()).toContain('Se perdió');
    });

    it('silenciar y reactivar llegan al transporte', async () => {
      await encender();
      sp.alternarSilencio();
      sp.alternarSilencio();

      expect(transporte.silencios).toEqual([true, false]);
      expect(sp.silenciado()).toBeFalse();
    });

    it('no se ofrece si la planta no sabe dar softphone', () => {
      capacidades = ['entrantes'];
      expect(sp.disponible()).toBeFalse();
    });

    it('y sí cuando la planta lo declara', () => {
      expect(sp.disponible()).toBeTrue();
    });
  });
});
