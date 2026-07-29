import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';
import { JwtPayload } from '../auth/auth.service';

/**
 * Chat en tiempo real (Socket.IO, namespace /chat). Autentica el handshake con
 * el mismo JWT del resto de la API; el tenant y la identidad salen del token.
 *  - El ciudadano (login civil) inicia un chat, que crea un caso (canal chat).
 *  - Los funcionarios de ese tenant reciben aviso del caso nuevo y pueden unirse
 *    a la sala del caso para conversar en vivo.
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly chat: ChatService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const token = client.handshake.auth?.token as string;
      const user = this.jwt.verify<JwtPayload>(token);
      client.data.user = user;
      // Los funcionarios escuchan los chats nuevos de su tenant.
      if (user.tipo === 'institucional') client.join(`op:${user.tenant}`);
    } catch {
      client.disconnect();
    }
  }

  private user(client: Socket): JwtPayload {
    return client.data.user as JwtPayload;
  }

  /** El ciudadano inicia la conversación: se crea el caso y su sala. */
  @SubscribeMessage('chat:iniciar')
  async iniciar(@ConnectedSocket() client: Socket, @MessageBody() body: { texto: string }) {
    const u = this.user(client);
    if (!body?.texto?.trim()) return { error: 'Mensaje vacío.' };
    const { caso, mensaje } = await this.chat.iniciar(u.tenant, u.nombre, body.texto, u.sub);
    client.join(`caso:${caso.id}`);
    client.emit('chat:iniciado', { casoId: caso.id, mensaje });
    this.server.to(`op:${u.tenant}`).emit('chat:nuevo', { caso });
    return { casoId: caso.id };
  }

  /** Un participante (funcionario o el ciudadano) se une a la sala del caso. */
  @SubscribeMessage('chat:unir')
  async unir(@ConnectedSocket() client: Socket, @MessageBody() body: { casoId: string }) {
    const u = this.user(client);
    client.join(`caso:${body.casoId}`);
    const mensajes = await this.chat.historial(u.tenant, body.casoId);
    client.emit('chat:historial', { casoId: body.casoId, mensajes });
  }

  /** Nuevo mensaje en la sala; se persiste y se difunde a los participantes. */
  @SubscribeMessage('chat:mensaje')
  async mensaje(@ConnectedSocket() client: Socket, @MessageBody() body: { casoId: string; texto: string }) {
    const u = this.user(client);
    if (!body?.texto?.trim()) return;
    const autorTipo = u.tipo === 'civil' ? 'ciudadano' : 'operador';
    const msg = await this.chat.guardar(u.tenant, body.casoId, autorTipo, u.nombre, body.texto);
    this.server.to(`caso:${body.casoId}`).emit('chat:mensaje', msg);
  }
}
