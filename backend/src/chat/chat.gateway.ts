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
import { origenPermitido } from '../common/cors';

/**
 * Chat en tiempo real (Socket.IO, namespace /chat). Autentica el handshake con
 * el mismo JWT del resto de la API; el tenant y la identidad salen del token.
 *  - El ciudadano (login civil) inicia un chat, que crea un caso (canal chat).
 *  - Los funcionarios de ese tenant reciben aviso del caso nuevo y pueden unirse
 *    a la sala del caso para conversar en vivo.
 */
// El mismo CORS_ORIGINS del resto de la API: antes este gateway reflejaba
// cualquier origen con credenciales, ignorando la lista configurada.
@WebSocketGateway({ namespace: '/chat', cors: { origin: origenPermitido, credentials: true } })
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
      // Los funcionarios de un tenant escuchan los chats nuevos de su tenant.
      if (user.tipo === 'institucional' && user.tenant) client.join(`op:${user.tenant}`);
    } catch {
      client.disconnect();
    }
  }

  private user(client: Socket): JwtPayload {
    return client.data.user as JwtPayload;
  }

  /** Tenant del socket (los participantes del chat siempre tienen tenant). */
  private tenantDe(client: Socket): string {
    return this.user(client).tenant ?? 'demo';
  }

  /** El ciudadano inicia la conversación: se crea el caso y su sala. */
  @SubscribeMessage('chat:iniciar')
  async iniciar(@ConnectedSocket() client: Socket, @MessageBody() body: { texto: string }) {
    const u = this.user(client);
    const tenant = this.tenantDe(client);
    if (!body?.texto?.trim()) return { error: 'Mensaje vacío.' };
    const { caso, mensaje } = await this.chat.iniciar(tenant, u.nombre, body.texto, u.sub);
    client.join(`caso:${caso.id}`);
    client.emit('chat:iniciado', { casoId: caso.id, mensaje });
    this.server.to(`op:${tenant}`).emit('chat:nuevo', { caso });
    return { casoId: caso.id };
  }

  /**
   * Un participante (funcionario o el ciudadano) se une a la sala del caso.
   *
   * La sala NO es pública: antes de entrar se verifica quién pide entrar.
   * Un ciudadano solo puede unirse al chat que él mismo inició (el caso que
   * creó su sesión) — sin esto, cualquiera con sesión civil podía leer y
   * escribir la conversación de emergencia de otro ciudadano con solo
   * conocer o iterar ids de caso. Un funcionario entra a cualquier chat de
   * su tenant, que es su bandeja de trabajo.
   */
  @SubscribeMessage('chat:unir')
  async unir(@ConnectedSocket() client: Socket, @MessageBody() body: { casoId: string }) {
    const u = this.user(client);
    const tenant = this.tenantDe(client);
    const caso = await this.chat.casoDeSala(tenant, body?.casoId ?? '');
    if (!caso || (u.tipo === 'civil' && caso.creadoPor !== u.sub)) {
      return { error: 'Chat no encontrado.' };
    }
    client.join(`caso:${caso.id}`);
    const mensajes = await this.chat.historial(tenant, caso.id);
    client.emit('chat:historial', { casoId: caso.id, mensajes });
    return { casoId: caso.id };
  }

  /** Nuevo mensaje en la sala; se persiste y se difunde a los participantes. */
  @SubscribeMessage('chat:mensaje')
  async mensaje(@ConnectedSocket() client: Socket, @MessageBody() body: { casoId: string; texto: string }) {
    const u = this.user(client);
    if (!body?.texto?.trim()) return;
    // Solo quien ya está DENTRO de la sala escribe en ella. La membresía la
    // otorgan chat:iniciar (el dueño) y chat:unir (verificado arriba); un
    // socket que nunca pasó por ahí no tiene voz en ese caso.
    if (!client.rooms.has(`caso:${body.casoId}`)) return { error: 'No participa en este chat.' };
    const autorTipo = u.tipo === 'civil' ? 'ciudadano' : 'operador';
    const msg = await this.chat.guardar(this.tenantDe(client), body.casoId, autorTipo, u.nombre, body.texto);
    this.server.to(`caso:${body.casoId}`).emit('chat:mensaje', msg);
  }
}
