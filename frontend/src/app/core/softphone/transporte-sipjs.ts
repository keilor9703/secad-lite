import { Injectable } from '@angular/core';
import { Session, SessionState } from 'sip.js';
import { SessionManager } from 'sip.js/lib/platform/web/session-manager';
import { ConfigSoftphone, OyentesSip, TransporteSip } from './transporte-sip';

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
 */
@Injectable({ providedIn: 'root' })
export class TransporteSipJs implements TransporteSip {
  private manager?: SessionManager;
  private sesion?: Session;
  private audio?: HTMLAudioElement;

  usarAudio(elemento: HTMLAudioElement): void {
    this.audio = elemento;
  }

  async conectar(config: ConfigSoftphone, oyentes: OyentesSip): Promise<void> {
    await this.desconectar();
    oyentes.registro('conectando');

    this.manager = new SessionManager(config.wss, {
      aor: `sip:${config.usuario}@${config.dominio}`,
      media: { constraints: { audio: true, video: false }, remote: { audio: this.audio } },
      userAgentOptions: {
        authorizationUsername: config.usuario,
        authorizationPassword: config.clave,
        // El navegador no debe anunciar qué es: es un dato que no hace falta
        // para hablar y que sí sirve para buscar vulnerabilidades conocidas.
        userAgentString: 'FALCON CAD',
        ...(config.ice?.length ? { sessionDescriptionHandlerFactoryOptions: { iceServers: config.ice } } : {}),
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
        onCallAnswered: () => oyentes.establecida(),
        onCallHangup: () => { this.sesion = undefined; oyentes.terminada(); },
      },
    });

    try {
      await this.manager.connect();
    } catch (e) {
      oyentes.registro('fallo', (e as Error)?.message ?? 'No fue posible conectar con la centralita.');
    }
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
    if (this.manager && this.sesion && this.sesion.state === SessionState.Established) {
      await this.manager.sendDTMF(this.sesion, dtmf).catch(() => undefined);
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
