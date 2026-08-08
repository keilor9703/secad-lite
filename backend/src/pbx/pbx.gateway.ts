import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PbxService } from './pbx.service';
import { JwtPayload } from '../auth/auth.service';
import { origenPermitido } from '../common/cors';

/**
 * Empuja las llamadas entrantes a los operadores en tiempo real (Socket.IO,
 * namespace /pbx). Autentica el handshake con el JWT; cada funcionario se une a
 * la sala de su tenant (`op:{tenant}`) y, con sesión institucional, a su sala
 * personal (`op:{tenant}:{username}`).
 *
 * Cuando la central (ACD) ya dirigió la llamada a un operador puntual, el
 * aviso va SOLO a su sala personal — nadie más del tenant lo ve timbrar, igual
 * que un teléfono de escritorio real no suena en el puesto de al lado. Sin esa
 * información (central sin ACD, o extensión sin funcionario asociado), se
 * difunde a todo el tenant como hasta ahora.
 */
// El canal en vivo va directo al backend: una reescritura de Vercel no
// reenvía websockets, así que aquí también hay que respetar CORS_ORIGINS.
@WebSocketGateway({ namespace: '/pbx', cors: { origin: origenPermitido, credentials: true } })
export class PbxGateway implements OnGatewayConnection, OnModuleInit {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly pbx: PbxService,
  ) {}

  onModuleInit(): void {
    // A quién se avisa cada evento:
    //  - 'entrante' dirigida por el ACD → solo a la sala personal del
    //    destinatario: en los demás puestos ni timbra, como un teléfono real.
    //  - Todo lo demás (tomada, soltada, atendida, colgada) → a la sala del
    //    tenant, que incluye al destinatario. Antes, el aviso de "ya la
    //    tomaron" iba solo a quien la tomó: los demás operadores la seguían
    //    viendo timbrar y recibían un 403 al intentar tomarla. Qué muestra
    //    cada quien de una llamada tomada lo decide el cliente con la misma
    //    regla del servidor (dueño o supervisor).
    this.pbx.eventos$.subscribe(({ tenant, tipo, llamada }) => {
      const sala = tipo === 'entrante' && llamada.destinatario
        ? `op:${tenant}:${llamada.destinatario}`
        : `op:${tenant}`;
      this.server.to(sala).emit(tipo === 'entrante' ? 'llamada:entrante' : 'llamada:cambio', llamada);
    });
  }

  handleConnection(client: Socket): void {
    try {
      const token = client.handshake.auth?.token as string;
      const user = this.jwt.verify<JwtPayload>(token);
      client.data.user = user;
      // El superadmin no tiene tenant propio: escucha el que tenga en gestión.
      const tenant = user.rol === 'superadmin'
        ? (client.handshake.auth?.tenant as string | undefined)?.trim()
        : user.tenant;
      if (user.tipo === 'institucional' && tenant) {
        client.join(`op:${tenant}`);
        client.join(`op:${tenant}:${user.sub}`);
      } else client.disconnect();
    } catch {
      client.disconnect();
    }
  }
}
