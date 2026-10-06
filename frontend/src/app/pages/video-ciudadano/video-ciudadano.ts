import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { iceServers, guardarIceFirmados } from '../../core/config-runtime';
import { intentarSonar } from './audio-operador';
import { PLAZO_UBICACION_MS, explicarFalloUbicacion, hayQuePedirToque, textoDelToque } from './permisos-ciudadano';

type EstadoPagina =
  | 'validando' | 'invalido' | 'pidiendo-permiso' | 'permiso-denegado'
  | 'esperando' | 'en-llamada' | 'finalizada';

interface RespuestaPublica {
  valido: boolean;
  mensaje?: string;
  sesionId?: string;
  estado?: string;
  /**
   * Servidores ICE con la credencial del TURN ya firmada y con vencimiento.
   * Vienen aquí y no en una ruta aparte porque esta respuesta solo se produce
   * cuando la clave corresponde a una sesión viva: una ruta pública suelta
   * sería un dispensador de credenciales para cualquiera.
   */
  iceServers?: RTCIceServer[];
  /** Marca unix (segundos) en que coturn deja de aceptar esa credencial. */
  iceVenceEn?: number;
  /**
   * Token firmado con el que se entra a la sala. Antes venía en la URL; ahora
   * la URL lleva solo una clave corta y el token lo entrega el servidor cuando
   * esa clave resulta válida — así el enlace del SMS es corto y creíble.
   */
  token?: string;
}

interface ChatMensaje { texto: string; propio: boolean; hora: string }

/**
 * La página que abre el CIUDADANO desde el enlace que le llegó por SMS.
 *
 * No tiene sesión ni cuenta: está llamando al 123 desde la calle, con el
 * celular, posiblemente en una situación de emergencia. Todo lo que la
 * autentica es la clave corta del enlace: el servidor la valida y, si sirve,
 * le entrega el token firmado con el que entra a la sala.
 *
 * Por eso vive fuera del layout autenticado y no depende de nada del resto de
 * la aplicación: si algo del área interna se rompe, esta página sigue en pie.
 */
@Component({
  selector: 'app-video-ciudadano',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './video-ciudadano.html',
  styleUrl: './video-ciudadano.scss',
})
export class VideoCiudadanoComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly estado = signal<EstadoPagina>('validando');
  readonly mensajeError = signal('');
  /** Aviso mientras el despachador se cae y vuelve — la llamada NO se corta. */
  readonly mensajeEspera = signal('');
  readonly chatMensajes = signal<ChatMensaje[]>([]);
  readonly chatAbierto = signal(false);
  readonly chatTexto = signal('');
  readonly ubicacionActiva = signal(false);
  readonly camaraFrontal = signal(false);
  /**
   * La voz del operador llegó pero el navegador no deja reproducirla sin un
   * toque. Se le pide al ciudadano, porque es el único que puede desbloquearlo.
   */
  readonly audioBloqueado = signal(false);
  /** El ciudadano dijo que NO a la ubicación. Es su decisión: no se le insiste. */
  readonly ubicacionDenegada = signal(false);
  /** Pasó el plazo de cortesía sin que llegara ninguna posición. */
  readonly plazoUbicacion = signal(false);
  /** Por qué no llega la ubicación, en palabras. Vacío cuando no hay nada que decir. */
  readonly motivoUbicacion = signal('');

  private estadoPermisos = computed(() => ({
    audioBloqueado: this.audioBloqueado(),
    ubicacionActiva: this.ubicacionActiva(),
    ubicacionDenegada: this.ubicacionDenegada(),
    plazoUbicacionCumplido: this.plazoUbicacion(),
  }));

  /** Un solo toque arregla el sonido y la ubicación; se pide una sola vez. */
  readonly pedirToque = computed(() => hayQuePedirToque(this.estadoPermisos()));
  readonly textoToque = computed(() => textoDelToque(this.estadoPermisos()));

  /** Lo que venía en la URL: la clave corta, o el token de un enlace antiguo. */
  private readonly clave = this.route.snapshot.paramMap.get('clave') ?? '';
  /** Token de sala, que el servidor entrega al validar la clave. */
  private token = '';
  private socket: Socket | null = null;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private camaraActual: 'environment' | 'user' = 'environment';
  private watchId: number | null = null;

  ngOnInit(): void {
    if (!this.clave) { this.estado.set('invalido'); return; }

    // Se valida el enlace ANTES de pedir cámara y micrófono: pedirle acceso a
    // la cámara a alguien que está en una emergencia, para después decirle que
    // el enlace venció, es maltratarlo.
    this.http.get<RespuestaPublica>(
      `${environment.apiBaseUrl}/videollamada/publico/${encodeURIComponent(this.clave)}`).subscribe({
      next: (r) => {
        if (!r.valido) {
          this.estado.set('invalido');
          this.mensajeError.set(r.mensaje || 'Este enlace ya no es válido.');
          return;
        }
        // Antes de tocar la cámara: si el servidor firmó credenciales de TURN,
        // guardarlas. Si no las mandó —un backend anterior a este cambio—, se
        // sigue con la credencial estática de runtime.json y la llamada
        // funciona igual.
        guardarIceFirmados(r.iceServers, r.iceVenceEn);

        // Un enlace antiguo trae el token en la URL y el servidor no manda
        // otro; en ese caso la clave ES el token.
        this.token = r.token ?? this.clave;
        void this.pedirPermisos();
      },
      error: () => {
        this.estado.set('invalido');
        this.mensajeError.set('No fue posible validar el enlace.');
      },
    });
  }

  ngOnDestroy(): void { this.desmontar(); }

  private async pedirPermisos(): Promise<void> {
    this.estado.set('pidiendo-permiso');

    if (!navigator.mediaDevices?.getUserMedia) {
      // Los navegadores solo exponen getUserMedia en contexto seguro (https o
      // localhost). Si el enlace se abrió por http, la API ni siquiera existe y
      // nunca llega a aparecer el permiso nativo — el ciudadano vería una
      // pantalla muerta sin explicación.
      this.mensajeError.set(
        'Este enlace debe abrirse con conexión segura (https://). Avísele al operador que lo atiende.');
      this.estado.set('permiso-denegado');
      return;
    }

    try {
      // La cámara trasera es la útil: muestra la escena. La frontal es la que
      // activan los navegadores si no se pide otra cosa. «ideal» y no «exact»
      // para no fallar en equipos con una sola cámara.
      this.local = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
      this.estado.set('esperando');
      this.conectar();
    } catch {
      this.estado.set('permiso-denegado');
      this.mensajeError.set(
        'Necesitamos su cámara y micrófono para atenderlo por video. ' +
        'Toque el candado junto a la dirección y permita el acceso.');
    }
  }

  private conectar(): void {
    const base = environment.apiBaseUrl.replace('/api', '');
    this.socket = io(`${base}/video`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    this.socket.on('connect', () => {
      // Al reconectar se vuelve a entrar con el mismo token: el enlace sigue
      // valiendo y el ciudadano no tiene que hacer nada.
      this.socket?.emit('video:unirse-ciudadano', { token: this.token });
    });

    this.socket.on('video:error', (m: string) => {
      this.mensajeError.set(m);
      this.estado.set('invalido');
    });

    this.socket.on('video:despachador-conectado', () => {
      this.mensajeEspera.set('');
    });

    this.socket.on('video:oferta', async (c: { sdp: string }) => {
      if (!c?.sdp) return;
      await this.responder(c.sdp);
    });

    this.socket.on('video:ice', async (c: { candidato: RTCIceCandidateInit }) => {
      if (!this.pc || !c?.candidato) return;
      try { await this.pc.addIceCandidate(c.candidato); } catch { /* candidato tardío */ }
    });

    this.socket.on('video:chat', (m: { emisor: string; texto: string; fecha: string }) => {
      this.chatMensajes.set([...this.chatMensajes(), {
        texto: m.texto,
        propio: m.emisor === 'CIUDADANO',
        hora: new Date(m.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
      }]);
      if (m.emisor === 'DESPACHADOR') this.chatAbierto.set(true);
    });

    this.socket.on('video:participante-desconectado', () => {
      // El despachador se cayó. NO se termina la llamada: puede volver, y
      // cortarla obligaría al ciudadano a empezar de nuevo en plena emergencia.
      this.mensajeEspera.set('Se perdió la conexión con el operador. Espere, estamos reconectando…');
    });

    this.socket.on('video:finalizada', () => {
      this.estado.set('finalizada');
      this.desmontar();
    });
  }

  /** Los mismos servidores ICE que usa el despachador. Ver config-runtime.ts. */
  private iceServers(): RTCIceServer[] {
    return iceServers();
  }

  /** Contesta la oferta del despachador con el video y audio del celular. */
  private async responder(sdp: string): Promise<void> {
    this.pc?.close();
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers() });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.socket?.emit('video:ice', { candidato: ev.candidate.toJSON() });
    };

    // El audio del despachador se reproduce; su video no se envía.
    this.pc.ontrack = (ev) => {
      this.vozOperador = ev.streams?.[0] ?? (ev.track ? new MediaStream([ev.track]) : null);
      void this.sonarOperador();
    };

    this.local?.getTracks().forEach((t) => this.pc!.addTrack(t, this.local!));

    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const respuesta = await this.pc.createAnswer();
    await this.pc.setLocalDescription(respuesta);
    this.socket?.emit('video:respuesta', { sdp: respuesta.sdp });

    this.estado.set('en-llamada');
    this.mostrarLocal();
    this.reportarUbicacion();
    this.desbloquearAlPrimerToque();
  }

  /** La voz del operador, guardada: puede llegar antes de que exista el <audio>. */
  private vozOperador: MediaStream | null = null;

  /**
   * Es un <video>, no un <audio>: Safari no reproduce un `MediaStream` remoto
   * en un `<audio>` de forma fiable. Ver `audio-operador.ts`.
   */
  private elementoAudio(): HTMLVideoElement | null {
    return document.getElementById('voz-operador') as HTMLVideoElement | null;
  }

  /**
   * Intenta que suene. Si el navegador lo rechaza, se enciende el aviso para
   * que el ciudadano lo desbloquee con un toque — nunca se queda en silencio
   * sin que nadie lo sepa, que es lo que pasaba.
   */
  private async sonarOperador(): Promise<void> {
    const el = this.elementoAudio();
    if (!el || !this.vozOperador) return;   // aún no hay nada que sonar
    this.audioBloqueado.set(!(await intentarSonar(el, this.vozOperador)));
  }

  /**
   * Desde un gesto del ciudadano: ahí el navegador sí deja sonar. Lo llama el
   * botón del aviso y también el primer toque en cualquier parte de la
   * página, para que la mayoría de las veces el aviso ni llegue a leerse.
   */
  /**
   * El toque del ciudadano: hace sonar al operador Y vuelve a pedir la
   * ubicación. Las dos fallan por lo mismo —la página nunca le pidió tocar
   * nada— así que se arreglan con el mismo gesto y no con dos.
   */
  async activarAudio(): Promise<void> {
    if (!this.ubicacionActiva() && !this.ubicacionDenegada()) {
      // Rearmar: un watch que nunca entregó nada no vuelve solo.
      if (this.watchId !== null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
      this.reportarUbicacion();
    }
    const el = this.elementoAudio();
    if (!el || !this.vozOperador) return;
    // `reiniciar` aquí y no en el intento automático: el pause()+play() es el
    // remedio del atasco de Safari y solo el gesto del ciudadano lo permite.
    this.audioBloqueado.set(!(await intentarSonar(el, this.vozOperador, { reiniciar: true })));
  }

  /**
   * El primer toque en cualquier parte de la pantalla reintenta la
   * reproducción. Así, si el ciudadano toca algo por su cuenta —el chat,
   * girar la cámara, o la propia imagen—, el sonido entra sin que llegue a
   * leer el aviso. El aviso es la red de seguridad, no el camino previsto.
   */
  private desbloquearAlPrimerToque(): void {
    if (this.quitarEscuchaToque) return;
    const alTocar = () => { void this.activarAudio(); };
    document.addEventListener('pointerdown', alTocar, { once: true });
    this.quitarEscuchaToque = () => document.removeEventListener('pointerdown', alTocar);
  }

  private quitarEscuchaToque: (() => void) | null = null;

  private mostrarLocal(): void {
    const v = document.getElementById('video-local') as HTMLVideoElement | null;
    if (v && this.local) v.srcObject = this.local;
  }

  /**
   * Reporta la posición mientras dure la llamada. Es opcional: si el ciudadano
   * no da el permiso, la llamada sigue igual — lo que se pierde es que el
   * despachador sepa a dónde mandar la unidad sin preguntárselo.
   */
  private reportarUbicacion(): void {
    if (!navigator.geolocation || this.watchId !== null) return;
    // Si en el plazo no llegó nada, se le ofrece el toque. Ver `permisos-ciudadano.ts`.
    setTimeout(() => this.plazoUbicacion.set(true), PLAZO_UBICACION_MS);

    // Una lectura suelta ANTES del seguimiento. En iPhone es la que provoca
    // el diálogo de permiso de forma fiable; `watchPosition` a secas se queda
    // callado más de la cuenta. Si falla, su error ya dice por qué — que era
    // justo lo que no se sabía.
    navigator.geolocation.getCurrentPosition(
      (pos) => this.enviarUbicacion(pos),
      (err) => this.falloUbicacion(err),
      { enableHighAccuracy: true, timeout: 15_000 },
    );

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.enviarUbicacion(pos),
      (err) => this.falloUbicacion(err),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }

  private enviarUbicacion(pos: GeolocationPosition): void {
    this.ubicacionActiva.set(true);
    this.motivoUbicacion.set('');
    this.socket?.emit('video:ubicacion', {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      precision: pos.coords.accuracy,
    });
  }

  /**
   * El fallo deja de ser invisible. Antes esto solo apagaba una señal: el
   * ciudadano no veía nada, el operador tampoco, y nadie podía decir siquiera
   * qué había pasado.
   */
  private falloUbicacion(err: GeolocationPositionError | undefined): void {
    this.ubicacionActiva.set(false);
    const f = explicarFalloUbicacion(err?.code);
    this.motivoUbicacion.set(f.mensaje);
    // El despachador necesita saberlo para preguntar la dirección a viva voz.
    this.socket?.emit('video:ubicacion-fallo', { motivo: f.paraElOperador });
    // code 1 = denegado. Deja de pedirse SOLO; el aviso con su botón sigue,
    // porque en iPhone esto suele ser un ajuste del teléfono que el ciudadano
    // puede cambiar y volver a intentar sin recargar.
    if (err?.code === 1) this.ubicacionDenegada.set(true);
  }

  /** Reintento explícito desde el aviso, tras corregir el ajuste del teléfono. */
  reintentarUbicacion(): void {
    if (this.watchId !== null) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    this.ubicacionDenegada.set(false);
    this.motivoUbicacion.set('');
    this.reportarUbicacion();
  }

  /** Cambia entre la cámara trasera y la frontal sin renegociar la conexión. */
  async cambiarCamara(): Promise<void> {
    if (!this.pc || !this.local) return;
    const destino = this.camaraActual === 'environment' ? 'user' : 'environment';

    try {
      const nuevo = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: destino } }, audio: true,
      });
      const pista = nuevo.getVideoTracks()[0];
      const emisor = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (emisor && pista) await emisor.replaceTrack(pista);

      this.local.getVideoTracks().forEach((t) => t.stop());
      this.local = nuevo;
      this.camaraActual = destino;
      this.camaraFrontal.set(destino === 'user');
      this.mostrarLocal();
    } catch {
      // Equipo con una sola cámara: no es un error que valga la pena mostrar.
    }
  }

  enviarChat(): void {
    const texto = this.chatTexto().trim();
    if (!texto) return;
    this.socket?.emit('video:chat', { texto });
    this.chatTexto.set('');
  }

  colgar(): void {
    this.socket?.emit('video:finalizar');
    this.estado.set('finalizada');
    this.desmontar();
  }

  private desmontar(): void {
    this.quitarEscuchaToque?.();
    this.quitarEscuchaToque = null;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.pc?.close();
    this.pc = null;
    this.socket?.disconnect();
    this.socket = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
  }
}
