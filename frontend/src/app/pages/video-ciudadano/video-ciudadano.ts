import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';

type EstadoPagina =
  | 'validando' | 'invalido' | 'pidiendo-permiso' | 'permiso-denegado'
  | 'esperando' | 'en-llamada' | 'finalizada';

interface RespuestaPublica {
  valido: boolean;
  mensaje?: string;
  sesionId?: string;
  estado?: string;
}

interface ChatMensaje { texto: string; propio: boolean; hora: string }

/**
 * La página que abre el CIUDADANO desde el enlace que le llegó por SMS.
 *
 * No tiene sesión ni cuenta: está llamando al 123 desde la calle, con el
 * celular, posiblemente en una situación de emergencia. Todo lo que la
 * autentica es el token de la URL.
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

  private readonly token = this.route.snapshot.paramMap.get('token') ?? '';
  private socket: Socket | null = null;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private camaraActual: 'environment' | 'user' = 'environment';
  private watchId: number | null = null;

  ngOnInit(): void {
    if (!this.token) { this.estado.set('invalido'); return; }

    // Se valida el enlace ANTES de pedir cámara y micrófono: pedirle acceso a
    // la cámara a alguien que está en una emergencia, para después decirle que
    // el enlace venció, es maltratarlo.
    this.http.get<RespuestaPublica>(
      `${environment.apiBaseUrl}/videollamada/publico/${this.token}`).subscribe({
      next: (r) => {
        if (!r.valido) {
          this.estado.set('invalido');
          this.mensajeError.set(r.mensaje || 'Este enlace ya no es válido.');
          return;
        }
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

  private iceServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    const e = environment as Partial<{ turnUrls: string[]; turnUsername: string; turnCredential: string }>;
    if (e.turnUrls?.length) {
      servers.push({ urls: e.turnUrls, username: e.turnUsername, credential: e.turnCredential });
    }
    return servers;
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
      const audio = document.getElementById('audio-operador') as HTMLAudioElement | null;
      if (audio && ev.streams[0]) audio.srcObject = ev.streams[0];
    };

    this.local?.getTracks().forEach((t) => this.pc!.addTrack(t, this.local!));

    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const respuesta = await this.pc.createAnswer();
    await this.pc.setLocalDescription(respuesta);
    this.socket?.emit('video:respuesta', { sdp: respuesta.sdp });

    this.estado.set('en-llamada');
    this.mostrarLocal();
    this.reportarUbicacion();
  }

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
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.ubicacionActiva.set(true);
        this.socket?.emit('video:ubicacion', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: pos.coords.accuracy,
        });
      },
      () => this.ubicacionActiva.set(false),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
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
