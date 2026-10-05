import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage,
  WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { VideollamadaService } from './videollamada.service';
import { VideoTokenService } from './video-token.service';

/** Lo que se guarda en el socket una vez verificado. Nada de esto lo dice el cliente. */
interface DatosSocket {
  tenant?: string;
  sesionId?: string;
  rol?: 'despachador' | 'ciudadano';
  usuario?: string;
}

/**
 * Señalización WebRTC entre el navegador del ciudadano y el del despachador.
 *
 * El audio y el video NUNCA pasan por aquí: van punto a punto entre los dos
 * navegadores. Por este socket solo viajan los mensajes de negociación (oferta,
 * respuesta y candidatos ICE) más el chat y la ubicación, que sí queremos
 * guardar.
 *
 * ── Dos formas de entrar, y por eso no hay un guard de autenticación ────────
 * El DESPACHADOR entra con el JWT normal de FALCON. El CIUDADANO no tiene
 * cuenta —está llamando al 123 desde la calle— y entra solo con el token del
 * enlace que le llegó por SMS. Cada evento valida lo que le corresponde.
 *
 * Una sala por sesión: como hay exactamente dos participantes, relayar al
 * "otro" de la sala es todo lo que hace falta.
 */
@WebSocketGateway({ namespace: '/video', cors: true })
export class VideollamadaGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(VideollamadaGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly tokens: VideoTokenService,
    private readonly video: VideollamadaService,
  ) {}

  private sala(sesionId: string): string {
    return `video:${sesionId}`;
  }

  private datos(socket: Socket): DatosSocket {
    return socket.data as DatosSocket;
  }

  /**
   * La conexión se acepta sin identificar: quién es se resuelve al unirse a
   * una sesión, porque despachador y ciudadano se autentican distinto.
   */
  handleConnection(socket: Socket): void {
    socket.data = {} as DatosSocket;
    socket.on('disconnect', () => this.alDesconectar(socket));
  }

  // ════════════════════════════════════════════════════════════════════════
  // DESPACHADOR — con el JWT normal
  // ════════════════════════════════════════════════════════════════════════

  @SubscribeMessage('video:unirse-despachador')
  async unirseDespachador(
    @ConnectedSocket() socket: Socket,
    @MessageBody() cuerpo: { sesionId?: string },
  ): Promise<void> {
    const token = socket.handshake.auth['token'] as string | undefined
      ?? socket.handshake.headers['authorization']?.replace('Bearer ', '');

    let payload: { sub?: string; tenant?: string | null; rol?: string };
    try {
      payload = this.jwt.verify(token ?? '');
    } catch {
      socket.emit('video:error', 'No autenticado.');
      return;
    }

    // El superadmin no lleva tenant propio en su token: el real es el que tiene
    // en gestión y viaja en el handshake, igual que en CasosGateway y PbxGateway.
    const tenant = payload.rol === 'superadmin'
      ? (socket.handshake.auth['tenant'] as string | undefined)?.trim()
      : payload.tenant ?? undefined;

    const sesionId = cuerpo?.sesionId?.trim();
    if (!tenant || !sesionId) {
      socket.emit('video:error', 'Faltan datos para unirse a la videollamada.');
      return;
    }

    // La sesión se busca CON el tenant del token: sin esto, conociendo el id de
    // una sesión de otra instancia se podría entrar a escuchar su señalización.
    const sesion = await this.video.obtener(tenant, sesionId);
    if (!sesion) {
      socket.emit('video:error', 'Videollamada no encontrada.');
      return;
    }

    Object.assign(socket.data, {
      tenant, sesionId, rol: 'despachador', usuario: payload.sub,
    } satisfies DatosSocket);
    await socket.join(this.sala(sesionId));

    socket.emit('video:unido', { estado: sesion.estado });
    // El ciudadano puede llevar rato esperando: que el despachador refrescó, se
    // le cayó la red, o entró un relevo de turno. Avisarle que ya hay alguien.
    socket.to(this.sala(sesionId)).emit('video:despachador-conectado');
  }

  // ════════════════════════════════════════════════════════════════════════
  // CIUDADANO — solo con el token del enlace
  // ════════════════════════════════════════════════════════════════════════

  @SubscribeMessage('video:unirse-ciudadano')
  async unirseCiudadano(
    @ConnectedSocket() socket: Socket,
    @MessageBody() cuerpo: { token?: string },
  ): Promise<void> {
    const datos = this.tokens.validar(cuerpo?.token);
    if (!datos) {
      socket.emit('video:error', 'Este enlace ya no es válido o expiró.');
      return;
    }

    // El tenant sale del token firmado, no de una cabecera: el ciudadano no
    // pasa por el resolutor de instancia y no tiene por qué poder elegirla.
    Object.assign(socket.data, {
      tenant: datos.tenant, sesionId: datos.sesionId, rol: 'ciudadano',
    } satisfies DatosSocket);

    const ip = this.ipDe(socket);
    await this.video.marcarConectada(datos.tenant, datos.sesionId, ip);
    await socket.join(this.sala(datos.sesionId));

    socket.emit('video:unido', { estado: 'CONECTADA' });
    socket.to(this.sala(datos.sesionId)).emit('video:ciudadano-conectado');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEÑALIZACIÓN — relay puro, sin lógica
  // ════════════════════════════════════════════════════════════════════════

  @SubscribeMessage('video:oferta')
  oferta(@ConnectedSocket() s: Socket, @MessageBody() c: { sdp?: string }): void {
    this.relayar(s, 'video:oferta', { sdp: c?.sdp });
  }

  @SubscribeMessage('video:respuesta')
  respuesta(@ConnectedSocket() s: Socket, @MessageBody() c: { sdp?: string }): void {
    this.relayar(s, 'video:respuesta', { sdp: c?.sdp });
  }

  @SubscribeMessage('video:ice')
  ice(@ConnectedSocket() s: Socket, @MessageBody() c: { candidato?: unknown }): void {
    this.relayar(s, 'video:ice', { candidato: c?.candidato });
  }

  /**
   * Manda algo al OTRO de la sala. La sala sale de lo que se guardó al unirse,
   * nunca de lo que diga el cliente: si el cliente pudiera indicar la sesión,
   * podría inyectar señalización en una llamada ajena conociendo su id.
   */
  private relayar(socket: Socket, evento: string, carga: unknown): void {
    const { sesionId } = this.datos(socket);
    if (!sesionId) return;
    socket.to(this.sala(sesionId)).emit(evento, carga);
  }

  // ════════════════════════════════════════════════════════════════════════
  // UBICACIÓN Y CHAT — sí pasan por el servidor, y se guardan
  // ════════════════════════════════════════════════════════════════════════

  @SubscribeMessage('video:ubicacion')
  async ubicacion(
    @ConnectedSocket() socket: Socket,
    @MessageBody() c: { lat?: number; lng?: number; precision?: number },
  ): Promise<void> {
    const { tenant, sesionId, rol } = this.datos(socket);
    // Solo el ciudadano reporta dónde está; del despachador no tendría sentido.
    if (!tenant || !sesionId || rol !== 'ciudadano') return;
    if (typeof c?.lat !== 'number' || typeof c?.lng !== 'number') return;

    await this.video.actualizarUbicacion(tenant, sesionId, c.lat, c.lng, c.precision);
    socket.to(this.sala(sesionId)).emit('video:ubicacion', {
      lat: c.lat, lng: c.lng, precision: c.precision ?? null,
    });
  }

  /**
   * El ciudadano no puede compartir dónde está, y el despachador tiene que
   * saberlo: es la diferencia entre esperar un punto que no va a llegar y
   * preguntarle la dirección mientras habla con él. No se guarda —no es un
   * dato del caso, es el estado de un intento— solo se le pasa al operador.
   */
  @SubscribeMessage('video:ubicacion-fallo')
  ubicacionFallo(
    @ConnectedSocket() socket: Socket,
    @MessageBody() c: { motivo?: string },
  ): void {
    const { tenant, sesionId, rol } = this.datos(socket);
    if (!tenant || !sesionId || rol !== 'ciudadano') return;
    const motivo = (c?.motivo ?? '').trim().slice(0, 300);
    if (!motivo) return;
    socket.to(this.sala(sesionId)).emit('video:ubicacion-fallo', { motivo });
  }

  @SubscribeMessage('video:chat')
  async chat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() c: { texto?: string },
  ): Promise<void> {
    const { tenant, sesionId, rol, usuario } = this.datos(socket);
    if (!tenant || !sesionId || !rol || !c?.texto?.trim()) return;

    const emisor = rol === 'despachador' ? 'DESPACHADOR' : 'CIUDADANO';
    const mensaje = await this.video.guardarMensajeChat(
      tenant, sesionId, emisor, c.texto, emisor === 'DESPACHADOR' ? usuario : null);

    // Si no se pudo guardar tampoco se relaya: lo que ve el otro extremo es
    // exactamente lo que quedó registrado, sin mensajes fantasma fuera de la
    // evidencia.
    if (!mensaje) return;

    this.server.to(this.sala(sesionId)).emit('video:chat', {
      id: mensaje.id, emisor: mensaje.emisor, texto: mensaje.texto,
      usuario: mensaje.usuario, fecha: mensaje.creadoEn,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CIERRE
  // ════════════════════════════════════════════════════════════════════════

  @SubscribeMessage('video:finalizar')
  async finalizar(@ConnectedSocket() socket: Socket): Promise<void> {
    const { tenant, sesionId } = this.datos(socket);
    if (!tenant || !sesionId) return;
    await this.video.marcarFinalizada(tenant, sesionId);
    this.avisarFinalizada(sesionId);
  }

  /**
   * Avisa a la sala que la llamada terminó.
   *
   * Es público porque el colgado del despachador ya no viaja SOLO por el
   * socket: va por HTTP, que llega aunque el socket esté muerto —o nunca haya
   * llegado a establecerse, que es lo que pasa si el proxy no deja pasar el
   * upgrade a WebSocket—. El controlador termina la sesión y llama aquí para
   * que el ciudadano, si sí está conectado, se entere igual.
   */
  avisarFinalizada(sesionId: string): void {
    this.server.to(this.sala(sesionId)).emit('video:finalizada');
  }

  /**
   * Alguien se fue sin colgar: cerró la pestaña, se quedó sin red, se apagó el
   * equipo. NO se finaliza la sesión — el otro sigue en ella y el que se cayó
   * puede volver por el mismo enlace. Solo se avisa, para que la otra pantalla
   * deje de mostrar una llamada que ya no tiene a nadie del otro lado.
   */
  private alDesconectar(socket: Socket): void {
    const { sesionId, rol } = this.datos(socket);
    if (!sesionId) return;
    this.logger.debug(`Se desconectó ${rol ?? 'alguien'} de la videollamada ${sesionId}.`);
    socket.to(this.sala(sesionId)).emit('video:participante-desconectado', { rol: rol ?? 'desconocido' });
  }

  private ipDe(socket: Socket): string | null {
    const reenviada = socket.handshake.headers['x-forwarded-for'];
    const cruda = Array.isArray(reenviada) ? reenviada[0] : reenviada;
    return (cruda?.split(',')[0]?.trim() || socket.handshake.address || null);
  }
}
