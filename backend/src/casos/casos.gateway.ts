import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CasoEntity } from './caso.entity';

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
      await socket.join(sala);
      this.logger.debug(`Socket ${socket.id} unido a sala ${sala}`);
    } catch {
      socket.disconnect();
    }
  }

  /** Emite a todos los clientes del tenant cuando cambia un caso. */
  emitirCambio(tenant: string, caso: CasoEnVivo): void {
    this.server.to(`tenant:${tenant}`).emit('caso:actualizado', caso);
  }

  emitirNuevo(tenant: string, caso: CasoEnVivo): void {
    this.server.to(`tenant:${tenant}`).emit('caso:nuevo', caso);
  }
}
