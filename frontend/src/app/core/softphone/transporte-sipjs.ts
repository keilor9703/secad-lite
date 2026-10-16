import { Injectable } from '@angular/core';
// Tipos solamente: `import type` se borra al compilar y por eso NO arrastra la
// biblioteca al paquete inicial. Ver `cargar()`.
import type { Session, SessionState } from 'sip.js';
import type { SessionManager } from 'sip.js/lib/platform/web/session-manager';
import { ConfigSoftphone, OyentesSip, TransporteSip } from './transporte-sip';
import { engancharAudioRemoto, soltarAudioRemoto } from './audio-remoto';
import { iceServers } from '../config-runtime';

/** Lo que hace falta de SIP.js, ya cargado. */
interface ModuloSip {
  SessionManager: typeof import('sip.js/lib/platform/web/session-manager').SessionManager;
  SessionState: typeof SessionState;
}

/**
 * La pila SIP de verdad: SIP.js sobre WebSocket.
 *
 * Es deliberadamente lo más pequeño posible, porque es la única parte que NO
 * se puede probar sin una centralita, micrófono y WebRTC al otro lado. Todo lo
 * que decide algo vive en `SoftphoneService`, detrás de la costura.
 *
 * Se usa `SessionManager` y no `SimpleUser` —que sería menos código— por un
 * dato que hace falta: `SimpleUser` esconde la sesión, y de la sesión sale el
 * número de quien llama (`remoteIdentity`). Sin ese número no se puede atar la
 * llamada que suena en el navegador con la que está en la cola de FALCON, que
 * es justamente el punto de todo esto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA BIBLIOTECA SE CARGA AL ENCENDER, NO AL ABRIR FALCON
 *
 * SIP.js pesa unos 260 kB y el paquete inicial de FALCON estaba en 495 kB con
 * un presupuesto de 500: meterla ahí lo dejaba en 756 y se lo cobraba a TODOS
 * —incluidos los municipios cuya planta no da softphone, que hoy son todos—
 * en la primera carga, que es la que se hace desde la sala de despacho a las
 * seis de la mañana.
 *
 * Así que entra por `import()` dentro de `conectar()`: el compilador la deja
 * en un trozo aparte que solo se baja cuando el operador oprime *Encender*.
 * Los `import type` de arriba se borran al compilar y no cuentan.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable({ providedIn: 'root' })
export class TransporteSipJs implements TransporteSip {
  private manager?: SessionManager;
  private sesion?: Session;
  private audio?: HTMLAudioElement;
  /** La biblioteca, una vez cargada. Se reutiliza entre encendidos. */
  private sip?: ModuloSip;

  usarAudio(elemento: HTMLAudioElement): void {
    this.audio = elemento;
  }

  async conectar(config: ConfigSoftphone, oyentes: OyentesSip): Promise<void> {
    await this.desconectar();
    oyentes.registro('conectando');

    const sip = await this.cargar();
    if (!sip) {
      oyentes.registro('fallo', 'No se pudo cargar el teléfono. Recargue la página e inténtelo otra vez.');
      return;
    }

    this.manager = new sip.SessionManager(config.wss, {
      aor: `sip:${config.usuario}@${config.dominio}`,
      media: { constraints: { audio: true, video: false }, remote: { audio: this.audio } },
      userAgentOptions: {
        authorizationUsername: config.usuario,
        authorizationPassword: config.clave,
        // El navegador no debe anunciar qué es: es un dato que no hace falta
        // para hablar y que sí sirve para buscar vulnerabilidades conocidas.
        userAgentString: 'FALCON CAD',
        // ───────────────────────────────────────────────────────────────
        // SIN ESTO LA LLAMADA SE ESTABLECE Y NO SE OYE NADA
        //
        // La señalización (SIP sobre WebSocket) y el audio (RTP) van por
        // caminos distintos: el primero sale por el WebSocket y funciona
        // siempre; el segundo tiene que atravesar el NAT de la sala de
        // despacho, y para eso el navegador necesita servidores ICE. Sin
        // ellos solo ofrece candidatos de su red local, la central no puede
        // responderle, y el resultado es exactamente lo que se vio: «En
        // llamada con 102» y silencio en los dos sentidos.
        //
        // La llave importa: va dentro de `peerConnectionConfiguration`. Antes
        // estaba suelta como `iceServers`, que SIP.js ignora sin decir nada
        // —un objeto que no entiende no es un error para él—.
        //
        // Se usan los MISMOS de la videollamada (`iceServers()`): el STUN y
        // el coturn de FALCON, con su credencial firmada. Montar un segundo
        // juego de servidores para el teléfono sería dos cosas que
        // configurar y una que se olvida.
        // ───────────────────────────────────────────────────────────────
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: { iceServers: [...(config.ice ?? []), ...iceServers()] },
        },
      },
      delegate: {
        onServerConnect: () => { void this.manager?.register(); },
        onServerDisconnect: (e) => oyentes.registro('fallo', e?.message ?? 'Se perdió la conexión con la centralita.'),
        onRegistered: () => oyentes.registro('registrado'),
        onCallReceived: (s) => {
          this.sesion = s;
          oyentes.entrante({
            // `remoteIdentity.uri.user` es el número de quien llama. Es el
            // único dato con el que se puede casar esta llamada con la de la
            // cola cuando la central no manda su identificador.
            numero: s.remoteIdentity?.uri?.user ?? '',
            callId: cabecera(s, 'X-Pbx-Call-Id') ?? cabecera(s, 'X-Call-Id'),
          });
        },
        onCallAnswered: () => oyentes.establecida(this.engancharAudio(oyentes)),
        onCallHangup: () => {
          this.sesion = undefined;
          // Soltar el flujo: un `<audio>` con un `srcObject` muerto se queda
          // con la última pista y la siguiente llamada puede no engancharse.
          soltarAudioRemoto(this.audio);
          oyentes.terminada();
        },
      },
    });

    try {
      await this.manager.connect();
    } catch (e) {
      oyentes.registro('fallo', (e as Error)?.message ?? 'No fue posible conectar con la centralita.');
    }
  }

  /**
   * Toma el flujo remoto de la sesión y lo engancha al elemento de audio.
   *
   * El cómo y el por qué están en `audio-remoto.ts`; aquí solo está lo que
   * depende de SIP.js: de dónde sale el flujo. Devuelve cuántas pistas había
   * para que el servicio pueda decir «sin audio», y si llegan después,
   * vuelve a avisar para retractarse.
   */
  private engancharAudio(oyentes: OyentesSip): number {
    const sdh = (this.sesion as unknown as {
      sessionDescriptionHandler?: { remoteMediaStream?: MediaStream };
    })?.sessionDescriptionHandler;
    return engancharAudioRemoto(this.audio, sdh?.remoteMediaStream, (n) => oyentes.establecida(n));
  }

  async desconectar(): Promise<void> {
    const m = this.manager;
    this.manager = undefined;
    this.sesion = undefined;
    if (!m) return;
    // Un fallo al cerrar no puede impedir apagar: el objeto ya se soltó.
    await m.disconnect().catch(() => undefined);
  }

  async contestar(): Promise<void> {
    if (this.manager && this.sesion) await this.manager.answer(this.sesion);
  }

  async colgar(): Promise<void> {
    if (!this.manager || !this.sesion) return;
    // `hangup` sirve para colgar y para rechazar: SIP.js manda BYE o CANCEL
    // según en qué estado esté la sesión.
    await this.manager.hangup(this.sesion).catch(() => undefined);
  }

  silenciar(silenciado: boolean): void {
    if (!this.manager || !this.sesion) return;
    if (silenciado) this.manager.mute(this.sesion);
    else this.manager.unmute(this.sesion);
  }

  async tono(dtmf: string): Promise<void> {
    const establecida = this.sip?.SessionState.Established;
    if (this.manager && this.sesion && this.sesion.state === establecida) {
      await this.manager.sendDTMF(this.sesion, dtmf).catch(() => undefined);
    }
  }

  /**
   * Trae SIP.js la primera vez que se enciende el teléfono.
   *
   * Devuelve null si no se pudo bajar —la red se cayó entre la carga de la
   * página y el clic, o el despliegue borró el trozo viejo— en vez de
   * reventar: el panel lo dice y el operador recarga.
   */
  private async cargar(): Promise<ModuloSip | null> {
    if (this.sip) return this.sip;
    try {
      const [web, nucleo] = await Promise.all([
        import('sip.js/lib/platform/web/session-manager'),
        import('sip.js'),
      ]);
      this.sip = { SessionManager: web.SessionManager, SessionState: nucleo.SessionState };
      return this.sip;
    } catch {
      return null;
    }
  }
}

/**
 * Una cabecera del INVITE, si la hay.
 *
 * Las centrales que mandan su identificador de llamada lo hacen en una
 * cabecera propia y no hay un nombre estándar, así que se prueban los dos
 * habituales y, si no está, se casa por número.
 */
function cabecera(s: Session, nombre: string): string | undefined {
  const req = (s as unknown as { request?: { getHeader?: (n: string) => string | undefined } }).request;
  return req?.getHeader?.(nombre) || undefined;
}
