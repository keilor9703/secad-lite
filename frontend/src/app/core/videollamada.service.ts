import { Injectable, computed, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { iceServers, guardarIceFirmados } from './config-runtime';

export type EstadoLlamada =
  | 'inactiva' | 'esperando' | 'conectando' | 'conectada' | 'finalizada' | 'error';

export interface ChatMensaje {
  texto: string;
  propio: boolean;
  hora: string;
}

export interface UbicacionCiudadano {
  lat: number;
  lng: number;
  precision?: number;
  /** Momento en que se recibió, para poder leer el recorrido en el tiempo. */
  en?: number;
}

/**
 * Metros mínimos entre dos puntos para considerarlos posiciones distintas.
 *
 * `watchPosition` reporta cada pocos segundos aunque el ciudadano esté quieto,
 * y el GPS de un celular oscila unos metros por su cuenta. Sin este filtro el
 * recorrido sería una maraña sobre un mismo punto.
 */
const METROS_MINIMOS = 8;

/** Tope de puntos guardados: una llamada larga no puede crecer sin límite. */
const MAX_PUNTOS = 600;

export interface VideollamadaCreada {
  sesionId: string;
  token: string;
  enlace: string;
  expiraEn: string;
  smsEnviado: boolean;
  mensaje: string;
  reutilizada: boolean;
}

export interface VideollamadaActiva {
  hay: boolean;
  sesionId?: string;
  estado?: string;
  token?: string;
  enlace?: string;
  expiraEn?: string;
  grabando?: boolean;
}

export interface VideoSesion {
  id: string;
  estado: string;
  usuarioDespachador: string;
  numeroTelefono?: string;
  creadoEn: string;
  conectadoEn?: string;
  finalizadoEn?: string;
  archivoGrabacionId?: string;
}

/** Lo que emite el gateway, ya guardado. */
interface ChatDelServidor {
  id: string;
  emisor: 'DESPACHADOR' | 'CIUDADANO';
  texto: string;
  usuario: string | null;
  fecha: string;
}

/** Cada cuánto MediaRecorder entrega un trozo de la grabación. */
const TROZO_MS = 4000;

/**
 * Techo de la grabación. Sin esto MediaRecorder elige el bitrate según la
 * resolución del track y en una llamada 720p se va a 2,5 Mbps: ~1,1 GB por
 * hora grabada, dentro de la base de datos y por lo tanto dentro de cada
 * respaldo completo. Con el techo son ~390 MB por hora, y el servidor tiene
 * 200 GB en total.
 *
 * No afecta a lo que ve el despachador: el video punto a punto va por su
 * propio canal y mantiene su calidad. Esto solo limita lo que se archiva, que
 * es donde el tamaño importa y donde 800 kbps siguen siendo suficientes para
 * reconocer personas, placas y lo que ocurrió.
 */
const VIDEO_BPS_GRABACION = 800_000;
const AUDIO_BPS_GRABACION = 64_000;

/** Reintentos por trozo antes de rendirse. Un trozo perdido es un hueco en la evidencia. */
const INTENTOS_POR_TROZO = 3;

/**
 * Lado DESPACHADOR de la videollamada con el ciudadano.
 *
 * El video va punto a punto entre los dos navegadores; por el socket solo viaja
 * la negociación. Se conecta al mismo namespace /video que la página pública
 * del ciudadano, pero autenticado con el JWT normal de FALCON.
 *
 * Una llamada a la vez: cada caso tiene un despachador y un ciudadano, no hay
 * servidor de mezcla.
 */
@Injectable({ providedIn: 'root' })
export class VideollamadaService {
  private socket: Socket | null = null;
  private pc: RTCPeerConnection | null = null;
  private micStream: MediaStream | null = null;
  private sesionId = '';
  private archivoGrabacionId = '';

  private readonly estadoSubject = new BehaviorSubject<EstadoLlamada>('inactiva');
  readonly estado$: Observable<EstadoLlamada> = this.estadoSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string>('');
  readonly error$: Observable<string> = this.errorSubject.asObservable();

  private readonly remotoSubject = new BehaviorSubject<MediaStream | null>(null);
  readonly remoto$: Observable<MediaStream | null> = this.remotoSubject.asObservable();

  private readonly chatSubject = new BehaviorSubject<ChatMensaje[]>([]);
  readonly chat$: Observable<ChatMensaje[]> = this.chatSubject.asObservable();

  private readonly chatDisponibleSubject = new BehaviorSubject<boolean>(false);
  readonly chatDisponible$: Observable<boolean> = this.chatDisponibleSubject.asObservable();

  private readonly ubicacionSubject = new BehaviorSubject<UbicacionCiudadano | null>(null);
  readonly ubicacion$: Observable<UbicacionCiudadano | null> = this.ubicacionSubject.asObservable();

  /** Por dónde ha pasado el ciudadano durante ESTA llamada, en orden. */
  private readonly recorridoSubject = new BehaviorSubject<UbicacionCiudadano[]>([]);
  readonly recorrido$: Observable<UbicacionCiudadano[]> = this.recorridoSubject.asObservable();

  private readonly ubicacionFalloSubject = new BehaviorSubject<string>('');
  /**
   * Por qué NO llega la ubicación del ciudadano. En una central esto no es un
   * detalle: es la diferencia entre esperar un punto que nunca va a llegar y
   * preguntarle la dirección mientras se habla con él.
   */
  readonly ubicacionFallo$: Observable<string> = this.ubicacionFalloSubject.asObservable();

  private readonly microfonoSubject = new BehaviorSubject<boolean>(true);
  readonly microfono$: Observable<boolean> = this.microfonoSubject.asObservable();

  private readonly grabandoSubject = new BehaviorSubject<boolean>(false);
  readonly grabando$: Observable<boolean> = this.grabandoSubject.asObservable();

  /**
   * Caso cuyo panel de videollamada está abierto, y teléfono propuesto.
   *
   * Vive en el servicio y no en un `input` del componente porque el panel ya
   * no pertenece a la página del caso: vive por encima del enrutador, que es
   * lo que le permite al despachador irse a Recepción o al mapa sin que la
   * llamada se caiga. La página solo dice QUÉ caso está mirando.
   */
  readonly casoPanel = signal<string | null>(null);
  readonly telefonoPanel = signal<string | null>(null);

  /**
   * Elemento donde se incrusta el panel cuando está ACOPLADO. Lo registra la
   * página del caso; cuando no hay ninguno —porque el despachador se fue a
   * otra pantalla— el panel se queda flotando, que es justo lo que se busca.
   */
  readonly anclaje = signal<HTMLElement | null>(null);

  /**
   * El estado como señal, y si hay o no una llamada viva. Lo consulta quien
   * decide si el panel debe seguir en pantalla al salir del caso: con llamada
   * en curso sigue (flotando), sin llamada se cierra.
   */
  readonly estadoActual = toSignal(this.estado$, { initialValue: 'inactiva' as EstadoLlamada });
  readonly hayLlamada = computed(
    () => this.estadoActual() !== 'inactiva' && this.estadoActual() !== 'finalizada');

  /**
   * Devuelve el panel a su posición flotante, ya mismo.
   *
   * Lo registra el caparazón flotante y lo llama la página al destruirse. Hace
   * falta que sea SÍNCRONO: si se dejara al efecto, el navegador se llevaría el
   * nodo junto con la página antes de que nadie lo rescate, y el <video> se
   * quedaría un instante desconectado del árbol en mitad de una llamada.
   */
  readonly devolverAFlotante = signal<(() => void) | null>(null);

  /** Abre el panel para un caso. Idempotente: volver a llamar no reinicia nada. */
  abrirPanel(casoId: string, telefono: string | null): void {
    this.casoPanel.set(casoId);
    this.telefonoPanel.set(telefono);
  }

  cerrarPanel(): void {
    this.casoPanel.set(null);
    this.telefonoPanel.set(null);
  }

  constructor(private readonly http: HttpClient, private readonly auth: AuthService) {}

  // ── API del caso ──────────────────────────────────────────────────────────

  crear(casoId: string, numeroTelefono: string): Promise<VideollamadaCreada> {
    return firstValueFrom(this.http.post<VideollamadaCreada>(
      `${environment.apiBaseUrl}/casos/${casoId}/videollamada`, { numeroTelefono }));
  }

  /**
   * ¿Hay una llamada en curso para este caso? Se consulta al abrir el caso para
   * ofrecer RECONECTARSE en vez de mandar otro enlace — necesario tras un F5,
   * un cambio de pestaña, una caída de red o un relevo de turno.
   */
  activa(casoId: string): Promise<VideollamadaActiva> {
    return firstValueFrom(this.http.get<VideollamadaActiva>(
      `${environment.apiBaseUrl}/casos/${casoId}/videollamada/activa`));
  }

  historial(casoId: string): Promise<VideoSesion[]> {
    return firstValueFrom(this.http.get<VideoSesion[]>(`${environment.apiBaseUrl}/casos/${casoId}/videollamadas`));
  }

  /**
   * Contenido de una grabación, como Blob.
   *
   * No se puede poner la URL de la API directamente en `<video src>`: esa ruta
   * exige sesión y un `<video>` no manda la cabecera `Authorization`. Así que
   * el archivo se baja por HttpClient —que sí pasa por el interceptor— y se
   * reproduce desde un `blob:` local.
   */
  grabacion(archivoId: string): Promise<Blob> {
    return firstValueFrom(this.http.get(
      `${environment.apiBaseUrl}/archivos/${archivoId}/contenido`, { responseType: 'blob' }));
  }

  historialChat(sesionId: string): Promise<ChatMensaje[]> {
    return firstValueFrom(this.http.get<ChatMensaje[]>(`${environment.apiBaseUrl}/videollamadas/${sesionId}/chat`));
  }

  // ── Señalización ──────────────────────────────────────────────────────────

  /** Entra a la sala de la sesión y queda esperando al ciudadano. */
  async iniciar(sesionId: string): Promise<void> {
    this.sesionId = sesionId;
    this.estadoSubject.next('esperando');
    this.errorSubject.next('');
    this.recorridoSubject.next([]);

    // Antes de abrir nada: pedirle al backend la credencial del TURN, que
    // ahora se firma por llamada y caduca. Si el backend todavía no la emite
    // —o la petición falla— se sigue con la credencial estática de
    // runtime.json, que es el respaldo. Una videollamada no se cancela porque
    // una petición auxiliar no respondió.
    await this.cargarIceServers();

    const base = environment.apiBaseUrl.replace('/api', '');
    this.socket = io(`${base}/video`, {
      auth: { token: this.auth.sesion()?.token, tenant: this.auth.tenantActivo() },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    this.socket.on('video:error', (m: string) => {
      this.errorSubject.next(m);
      this.estadoSubject.next('error');
    });

    this.socket.on('video:ciudadano-conectado', () => {
      this.estadoSubject.next('conectando');
      void this.crearOferta();
    });

    this.socket.on('video:respuesta', async (c: { sdp: string }) => {
      if (!this.pc || !c?.sdp) return;
      await this.pc.setRemoteDescription({ type: 'answer', sdp: c.sdp });
    });

    this.socket.on('video:ice', async (c: { candidato: RTCIceCandidateInit }) => {
      if (!this.pc || !c?.candidato) return;
      try { await this.pc.addIceCandidate(c.candidato); } catch { /* candidato tardío */ }
    });

    // El ciudadano colgó: hay que ASEGURAR la grabación antes de desmontar.
    this.socket.on('video:finalizada', () => { void this.cerrarTodo(); });

    // Se fue sin colgar. La sesión NO se da por terminada —puede volver— pero
    // la grabación sí se cierra ya: el video que llegaba dejó de llegar.
    this.socket.on('video:participante-desconectado', (c: { rol: string }) => {
      if (c?.rol !== 'ciudadano') return;
      this.estadoSubject.next('esperando');
      this.errorSubject.next('El ciudadano se desconectó. La grabación se guardó automáticamente.');
      void this.finalizarGrabacion();
    });

    this.socket.on('video:ubicacion', (c: { lat: number; lng: number; precision: number | null }) => {
      const punto: UbicacionCiudadano = {
        lat: c.lat, lng: c.lng, precision: c.precision ?? undefined, en: Date.now(),
      };
      this.ubicacionSubject.next(punto);
      this.ubicacionFalloSubject.next('');
      this.acumularRecorrido(punto);
    });

    this.socket.on('video:ubicacion-fallo', (c: { motivo?: string }) => {
      this.ubicacionFalloSubject.next(c?.motivo ?? '');
    });

    // El chat llega YA GUARDADO y el servidor lo reenvía a toda la sala, emisor
    // incluido: por eso los mensajes propios entran por aquí y no se pintan al
    // enviarlos. Lo que se ve en pantalla es exactamente lo que quedó en el caso.
    this.socket.on('video:chat', (m: ChatDelServidor) => {
      this.chatSubject.next([...this.chatSubject.value, {
        texto: String(m?.texto ?? ''),
        propio: m?.emisor === 'DESPACHADOR',
        hora: this.horaDe(m?.fecha),
      }]);
    });

    this.socket.emit('video:unirse-despachador', { sesionId });

    // El chat depende solo de la señalización: sirve aunque el enlace punto a
    // punto no llegue a establecerse.
    this.chatDisponibleSubject.next(true);

    this.prepararPeerConnection();
  }

  /**
   * Pide al backend los servidores ICE con la credencial del TURN firmada.
   *
   * No lanza: lo peor que puede pasar es que la llamada use el respaldo.
   */
  private async cargarIceServers(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ iceServers?: RTCIceServer[]; venceEn?: number }>(
        `${environment.apiBaseUrl}/videollamada/ice`));
      guardarIceFirmados(r?.iceServers, r?.venceEn);
    } catch {
      // Silencio a propósito: el respaldo cubre este caso y avisar aquí solo
      // llenaría la consola del despachador en un despliegue sin TURN_SECRET.
    }
  }

  /**
   * Servidores ICE: el STUN siempre, y el TURN propio solo si el despliegue lo
   * configuró. Sin TURN, muchas redes celulares con NAT simétrico de operador
   * no completan el flujo de medios aunque el ICE parezca conectado.
   *
   * La configuración vive en el servidor, no en el código — ver
   * core/config-runtime.ts.
   */
  private iceServers(): RTCIceServer[] {
    return iceServers();
  }

  private prepararPeerConnection(): void {
    // Al reconectar, la conexión anterior quedó muerta: cerrarla antes de crear
    // la nueva, o el navegador se queda con transceivers huérfanos.
    this.pc?.close();
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers() });

    // Un MediaStream propio al que se le van sumando las pistas que llegan.
    // Crear uno nuevo por pista —el respaldo evidente— hace que el segundo
    // `ontrack` reemplace al primero: queda video sin audio, o al revés. Y la
    // grabación, que toma el stream de aquí, se quedaría con el viejo.
    const recibido = new MediaStream();

    this.pc.ontrack = (ev) => {
      const original = ev.streams?.[0] ?? null;
      if (original) {
        this.remotoSubject.next(original);
      } else if (ev.track) {
        recibido.addTrack(ev.track);
        // Se reemite para que el <video> y la grabación vean la pista nueva.
        this.remotoSubject.next(recibido);
      }
      this.estadoSubject.next('conectada');
    };

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.socket?.emit('video:ice', { candidato: ev.candidate.toJSON() });
    };

    // Se cortó el flujo de medios. El video que se grababa dejó de llegar, así
    // que la grabación se asegura de inmediato en vez de esperar a que alguien
    // cuelgue.
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState;
      if (st === 'connected') {
        this.estadoSubject.next('conectada');
      } else if (st === 'failed' || st === 'disconnected') {
        if (this.grabacionActiva) {
          this.errorSubject.next('Se perdió la conexión con el ciudadano. La grabación se guardó automáticamente.');
          void this.finalizarGrabacion();
        }
        this.estadoSubject.next('esperando');
      }
    };
  }

  private async crearOferta(): Promise<void> {
    if (!this.pc || !this.socket) return;

    // El video es unidireccional: el ciudadano muestra la escena, el
    // despachador no manda su cámara. El audio sí va en los dos sentidos —el
    // despachador necesita poder hablarle—, así que se captura su micrófono y
    // se conecta al emisor de ese transceiver.
    this.pc.addTransceiver('video', { direction: 'recvonly' });
    const audio = this.pc.addTransceiver('audio', { direction: 'sendrecv' });

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await audio.sender.replaceTrack(this.micStream.getAudioTracks()[0]);
      this.microfonoSubject.next(true);
    } catch {
      // Sin micrófono el despachador sigue viendo y oyendo al ciudadano; solo
      // no puede hablarle, y le queda el chat. Se dice, en vez de dejar la
      // interfaz mostrando un micrófono activo que no lo está.
      this.microfonoSubject.next(false);
      this.errorSubject.next(
        'No se pudo activar su micrófono — el ciudadano no lo escuchará. ' +
        'Conceda el permiso en el candado junto a la dirección y vuelva a iniciar la videollamada.');
    }

    const oferta = await this.pc.createOffer();
    await this.pc.setLocalDescription(oferta);
    this.socket.emit('video:oferta', { sdp: oferta.sdp });
  }

  /**
   * Manda un mensaje. Va por el socket —no por un canal punto a punto— para que
   * quede registrado en el caso. NO se pinta aquí: se pinta cuando vuelve del
   * servidor, ya guardado.
   */
  enviarChat(texto: string): void {
    const limpio = texto.trim();
    if (!limpio || !this.socket) return;
    this.socket.emit('video:chat', { texto: limpio });
  }

  /** Silencia o reactiva el micrófono sin renegociar la conexión. */
  alternarMicrofono(): void {
    const track = this.micStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    this.microfonoSubject.next(track.enabled);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GRABACIÓN A PRUEBA DE FALLOS
  //
  //  Acumularla en memoria y subirla solo al oprimir Detener pierde la
  //  grabación entera ante cualquier final abrupto: el ciudadano cuelga, se
  //  refresca la página, se cae la red, se cierra el navegador. Como esto puede
  //  ser material probatorio, no sirve.
  //
  //  Cada trozo se sube apenas sale. Lo que ya llegó al servidor está a salvo
  //  pase lo que pase aquí, y el cierre se dispara desde TODOS los caminos de
  //  terminación, no solo desde el botón.
  // ══════════════════════════════════════════════════════════════════════════

  private recorder: MediaRecorder | null = null;
  /** Ya se avisó de un trozo perdido en esta grabación: no se repite el aviso. */
  private avisoTrozoPerdido = false;
  /** Cola secuencial: los trozos deben llegar EN ORDEN o el .webm sale corrupto. */
  private cola: Promise<void> = Promise.resolve();
  private grabacionActiva = false;
  private indiceTrozo = 0;

  get estaGrabando(): boolean { return this.grabacionActiva; }

  async iniciarGrabacion(): Promise<void> {
    const stream = this.remotoSubject.value;
    if (!stream || this.grabacionActiva) return;

    // Se abre el archivo ANTES de grabar: si esta pestaña muere, lo que se
    // alcance a subir ya quedó guardado y el barrido del servidor lo cierra.
    const r = await firstValueFrom(this.http.post<{ ok: boolean; archivoId: string }>(
      `${environment.apiBaseUrl}/videollamadas/${this.sesionId}/grabacion`, {}));
    if (!r?.ok || !r.archivoId) {
      this.errorSubject.next('No se pudo iniciar la grabación.');
      return;
    }

    this.archivoGrabacionId = r.archivoId;
    this.indiceTrozo = 0;
    this.avisoTrozoPerdido = false;
    this.grabacionActiva = true;
    this.grabandoSubject.next(true);

    this.recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm',
      videoBitsPerSecond: VIDEO_BPS_GRABACION,
      audioBitsPerSecond: AUDIO_BPS_GRABACION,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.encolar(e.data);
    };
    this.recorder.start(TROZO_MS);
  }

  /** Encola la subida preservando el orden, sin bloquear al grabador. */
  private encolar(trozo: Blob): void {
    const archivoId = this.archivoGrabacionId;
    const indice = this.indiceTrozo++;
    this.cola = this.cola.then(() => this.subirTrozo(archivoId, indice, trozo));
  }

  private async subirTrozo(archivoId: string, indice: number, trozo: Blob): Promise<void> {
    const form = new FormData();
    form.append('file', trozo, `trozo-${indice}.webm`);
    form.append('indice', String(indice));

    let ultimoEstado = 0;
    for (let intento = 1; intento <= INTENTOS_POR_TROZO; intento++) {
      try {
        await firstValueFrom(this.http.post(
          `${environment.apiBaseUrl}/archivos/${archivoId}/chunk`, form));
        return;
      } catch (e) {
        ultimoEstado = (e as { status?: number })?.status ?? 0;
        // El índice hace idempotente el reintento: si el trozo sí había
        // llegado, el servidor no lo duplica.
        if (intento < INTENTOS_POR_TROZO) await new Promise((r) => setTimeout(r, 500 * intento));
      }
    }

    // Se agotaron los reintentos. Se avisa UNA sola vez: durante una llamada
    // que falla, esto se repetiría cada pocos segundos y taparía el video.
    if (this.avisoTrozoPerdido) return;
    this.avisoTrozoPerdido = true;

    // El detalle técnico va a la consola, para quien tenga que arreglarlo; el
    // despachador solo necesita saber si la grabación le sirve o no.
    console.error(
      `[videollamada] el servidor rechazó un trozo de la grabación (HTTP ${ultimoEstado || 'sin respuesta'}). ` +
      (ultimoEstado === 413
        ? 'Es un límite de tamaño del proxy: suba client_max_body_size en nginx.'
        : 'Revise el registro del servidor.'));

    this.errorSubject.next(ultimoEstado === 413
      ? 'La grabación no se está guardando completa: el servidor rechaza los fragmentos por tamaño. ' +
        'Avise al administrador; la llamada continúa normal.'
      : 'La grabación no se está guardando completa: el servidor rechazó un fragmento. ' +
        'Avise al administrador; la llamada continúa normal.');
  }

  /**
   * Cierra la grabación. Idempotente y segura de llamar desde cualquier camino
   * de terminación: el botón, colgar, que el ciudadano cuelgue, que se caiga la
   * conexión o que se destruya el componente.
   */
  async finalizarGrabacion(): Promise<boolean> {
    if (!this.grabacionActiva) return false;
    this.grabacionActiva = false;
    this.grabandoSubject.next(false);

    const archivoId = this.archivoGrabacionId;

    if (this.recorder && this.recorder.state !== 'inactive') {
      // stop() dispara un último ondataavailable con lo que quede.
      const ultimo = new Promise<void>((r) => { this.recorder!.onstop = () => r(); });
      this.recorder.stop();
      await ultimo;
    }
    this.recorder = null;

    await this.cola;

    try {
      await firstValueFrom(this.http.post(
        `${environment.apiBaseUrl}/archivos/${archivoId}/finalizar`, {}));
      return true;
    } catch {
      // Los trozos YA están en el servidor: el barrido lo cierra solo. La
      // evidencia no se pierde por esto.
      return false;
    }
  }

  // ── Cierre ────────────────────────────────────────────────────────────────

  /**
   * Cierre ordenado: primero se asegura la grabación, después se cierra la
   * sesión. El orden importa — desmontar la conexión antes perdería el último
   * trozo del video.
   */
  async colgar(): Promise<void> {
    await this.finalizarGrabacion();
    this.socket?.emit('video:finalizar');
    // Y por HTTP, que llega aunque el socket esté muerto o nunca se haya
    // establecido. Sin esto, colgar desde «Esperando al ciudadano» con la
    // señalización caída dejaba la sesión viva: el caso seguía ofreciendo
    // retomar, y pedir un enlace nuevo devolvía el viejo.
    await this.finalizarEnServidor();
    this.desmontar();
  }

  /**
   * Termina la sesión en el servidor por HTTP. Idempotente y silenciosa: si
   * falla, queda el aviso por socket y, en último término, el vencimiento.
   */
  private async finalizarEnServidor(): Promise<void> {
    const sesionId = this.sesionId;
    if (!sesionId) return;
    try {
      await firstValueFrom(this.http.post(
        `${environment.apiBaseUrl}/videollamadas/${sesionId}/finalizar`, {}));
    } catch { /* el socket y el vencimiento son el respaldo */ }
  }

  /** El ciudadano colgó: guardar la grabación y desmontar. */
  private async cerrarTodo(): Promise<void> {
    await this.finalizarGrabacion();
    this.desmontar();
  }

  /**
   * Salida de emergencia: el componente se destruye o el usuario abandona la
   * página. No hay tiempo de esperar promesas, así que el guardado se dispara
   * en segundo plano; lo ya subido está a salvo y el barrido cierra el resto.
   */
  abandonar(): void {
    if (this.grabacionActiva) void this.finalizarGrabacion();
    this.socket?.emit('video:finalizar');

    // Aquí puede estar cerrándose la pestaña: una petición normal se cancela
    // al descargar la página, `keepalive` la deja salir igual. Por eso este
    // camino usa fetch y no HttpClient —que no lo admite— y pone el token a
    // mano, que es lo que haría el interceptor.
    const sesionId = this.sesionId;
    const token = this.auth.sesion()?.token;
    if (sesionId && token) {
      void fetch(`${environment.apiBaseUrl}/videollamadas/${sesionId}/finalizar`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      }).catch(() => { /* cerrando: no hay a quién avisarle */ });
    }

    this.desmontar();
  }

  private desmontar(): void {
    this.pc?.close();
    this.pc = null;
    this.socket?.disconnect();
    this.socket = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.remotoSubject.next(null);
    this.chatSubject.next([]);
    this.chatDisponibleSubject.next(false);
    this.microfonoSubject.next(true);
    this.ubicacionSubject.next(null);
    this.recorridoSubject.next([]);
    this.grabandoSubject.next(false);
    this.estadoSubject.next('finalizada');
  }

  /**
   * Suma el punto al recorrido si de verdad se movió.
   *
   * Si el ciudadano camina, la línea muestra por dónde pasó —y hacia dónde va,
   * que es lo que el despachador necesita para mandar la unidad al sitio
   * correcto y no al que reportó hace cinco minutos—.
   */
  private acumularRecorrido(punto: UbicacionCiudadano): void {
    const previos = this.recorridoSubject.value;
    const ultimo = previos[previos.length - 1];
    if (ultimo && this.metrosEntre(ultimo, punto) < METROS_MINIMOS) return;

    const siguiente = [...previos, punto];
    this.recorridoSubject.next(
      siguiente.length > MAX_PUNTOS ? siguiente.slice(-MAX_PUNTOS) : siguiente);
  }

  /** Distancia aproximada en metros (fórmula del haversine). */
  private metrosEntre(a: UbicacionCiudadano, b: UbicacionCiudadano): number {
    const R = 6371000;
    const rad = (g: number) => (g * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  private horaDe(fecha: string | undefined): string {
    const d = fecha ? new Date(fecha) : new Date();
    return (isNaN(d.getTime()) ? new Date() : d)
      .toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
}
