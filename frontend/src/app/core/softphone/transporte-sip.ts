/**
 * LA COSTURA ENTRE FALCON Y UNA PILA SIP
 *
 * Todo lo que FALCON necesita de un teléfono: registrarse, enterarse de que
 * entra una llamada, contestar, colgar, silenciar y marcar tonos. Nada más.
 *
 * Existe por una razón concreta: la pila SIP de verdad (SIP.js sobre
 * WebSocket) no se puede ejercitar en una prueba —necesita una centralita al
 * otro lado, micrófono y WebRTC— y toda la lógica que de verdad importa no es
 * SIP: es QUÉ se hace con la llamada en FALCON (atarla a la de la cola,
 * tomarla para el operador, no tomar la de otro). Con esta costura, esa
 * lógica se prueba con un doble y el adaptador real queda del tamaño de lo
 * que no se puede probar.
 *
 * Y de paso: si mañana hay que cambiar de biblioteca —o el proveedor exige su
 * propio widget—, lo que cambia es un archivo.
 */

/** Con qué se registra este navegador. Lo entrega `GET /api/pbx/softphone`. */
export interface ConfigSoftphone {
  /** WebSocket de señalización (`wss://…`). */
  wss: string;
  /** Dominio SIP con el que se arma la identidad (`101@dominio`). */
  dominio: string;
  /** La extensión de este operador. */
  usuario: string;
  /** Su clave SIP. */
  clave: string;
  /** Servidores ICE, si el proveedor exige los suyos. */
  ice?: { urls: string | string[]; username?: string; credential?: string }[];
}

/** En qué anda el registro contra la centralita. */
export type EstadoSip = 'apagado' | 'conectando' | 'registrado' | 'fallo';

/** Una llamada que llega por SIP, con lo poco que se puede saber del INVITE. */
export interface LlamadaSip {
  /** Quién llama, del `From`. Puede venir vacío si la central no lo manda. */
  numero: string;
  /**
   * El identificador de la central, si lo pone en una cabecera.
   *
   * Cuando viene, atar esta llamada con la de la cola es exacto. Cuando no
   * —y es lo normal—, hay que casar por número, que es lo que hace
   * `SoftphoneService`.
   */
  callId?: string;
}

/** Lo que el transporte le avisa a FALCON. */
export interface OyentesSip {
  registro(estado: EstadoSip, motivo?: string): void;
  entrante(llamada: LlamadaSip): void;
  /** Hay audio en los dos sentidos. */
  establecida(): void;
  terminada(): void;
}

/** Un teléfono, visto por FALCON. */
export interface TransporteSip {
  conectar(config: ConfigSoftphone, oyentes: OyentesSip): Promise<void>;
  desconectar(): Promise<void>;
  contestar(): Promise<void>;
  colgar(): Promise<void>;
  silenciar(silenciado: boolean): void;
  tono(dtmf: string): Promise<void>;
  /** Dónde suena la llamada. */
  usarAudio(elemento: HTMLAudioElement): void;
}
