import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CasoEntity } from './caso.entity';
import { MensajeChatInternoEntity } from './chat-interno.entity';

/**
 * El caso tal como viaja por el socket: con el estado de CADA entidad que lo
 * atiende. Va todo junto y cada pantalla se queda con el canal que le toca
 * —hoy el socket tiene una sola sala por tenant y el token no lleva los
 * canales del usuario, así que no hay forma de dirigir la emisión sin cambiar
 * el JWT (lo que cerraría las sesiones abiertas). El volumen de casos por
 * secad es pequeño y el filtro en el cliente es inmediato.
 */
export type CasoEnVivo = CasoEntity & {
  canalesEstado?: Array<{ canalId: string; agenciaId: string; estado: string }>;
};

@WebSocketGateway({ namespace: '/casos', cors: true })
export class CasosGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(CasosGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = socket.handshake.auth['token'] as string | undefined
        ?? socket.handshake.headers['authorization']?.replace('Bearer ', '');
      if (!token) { socket.disconnect(); return; }
      const payload = this.jwt.verify<{ tenant: string }>(token);
      const sala = `tenant:${payload.tenant}`;
      // Se guarda el tenant YA VERIFICADO del token, para que 'caso:unirse'
      // no tenga que confiar en lo que el cliente diga que es su tenant —
      // sin esto, alguien podría unirse a la sala de chat de un caso de OTRO
      // tenant con solo adivinar su id.
      socket.data.tenant = payload.tenant;
      await socket.join(sala);
      this.logger.debug(`Socket ${socket.id} unido a sala ${sala}`);
    } catch {
      socket.disconnect();
    }
  }

  /**
   * El chat de un caso va en una sala propia (no en la del tenant entero):
   * a diferencia del estado de un caso, el texto de un chat es contenido
   * libre, y no hay razón para que viaje al navegador de quien no tiene ese
   * caso abierto. Se une solo mientras el detalle del caso está en pantalla.
   */
  @SubscribeMessage('caso:unirse')
  async unirseAChat(@ConnectedSocket() socket: Socket, @MessageBody() casoId: string): Promise<void> {
    const tenant = socket.data.tenant as string | undefined;
    if (!tenant || !casoId) return;
    await socket.join(`caso:${tenant}:${casoId}`);
  }

  @SubscribeMessage('caso:salir')
  async salirDeChat(@ConnectedSocket() socket: Socket, @MessageBody() casoId: string): Promise<void> {
    const tenant = socket.data.tenant as string | undefined;
    if (!tenant || !casoId) return;
    await socket.leave(`caso:${tenant}:${casoId}`);
  }

  /** Emite a todos los clientes del tenant cuando cambia un caso. */
  emitirCambio(tenant: string, caso: CasoEnVivo): void {
    this.server.to(`tenant:${tenant}`).emit('caso:actualizado', caso);
  }

  emitirNuevo(tenant: string, caso: CasoEnVivo): void {
    this.server.to(`tenant:${tenant}`).emit('caso:nuevo', caso);
  }

  /** Solo a quienes tienen abierto el detalle de ESE caso (sala 'caso:{tenant}:{casoId}'). */
  emitirMensajeChat(tenant: string, casoId: string, mensaje: MensajeChatInternoEntity): void {
    this.server.to(`caso:${tenant}:${casoId}`).emit('chat:mensaje', mensaje);
  }
}
