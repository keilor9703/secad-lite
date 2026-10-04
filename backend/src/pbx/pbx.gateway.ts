import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { LlamadaEvento, PbxService } from './pbx.service';
import { JwtPayload } from '../auth/auth.service';
import { origenPermitido } from '../common/cors';

/**
 * Quién supervisa. Misma regla que aplica `PbxController.actor()` al listar la
 * cola — repetida aquí porque el saludo del socket solo tiene el token, no la
 * petición HTTP. Si las dos reglas se separan, el operador ve una cosa en vivo
 * y otra al refrescar, que es exactamente el defecto que esto corrige.
 */
export function esSupervisor(u: JwtPayload): boolean {
  return u?.rol === 'superadmin' || (u?.permisos ?? []).includes('casos.ver_todos');
}

/**
 * A qué salas va un evento de la cola.
 *
 * Función aparte y pura para poder probarla: es la regla de quién se entera de
 * qué, y equivocarse aquí no rompe nada visible —simplemente alguien deja de
 * enterarse de una llamada—, que es la peor clase de error en un CAD.
 *
 *   · Entrante dirigida por el ACD a un funcionario → su puesto, y la
 *     supervisión. En los demás puestos ni timbra, como un teléfono real.
 *   · Todo lo demás —entrante sin dueño, y cualquier cambio (tomada, soltada,
 *     atendida, colgada)— → todo el tenant. El aviso de «ya la tomaron» tiene
 *     que llegarle a todos, o los demás la seguirían viendo timbrar.
 *
 * La supervisión va en la primera porque ya veía esas llamadas al refrescar
 * (`PbxService.listar` se las devuelve, para poder auxiliar un puesto vacío) y
 * en vivo no: la cola le aparecía distinta antes y después de un F5.
 */
export function salasDelEvento(e: LlamadaEvento): string[] {
  if (e.tipo !== 'entrante' || !e.llamada.destinatario) return [`op:${e.tenant}`];
  return [`op:${e.tenant}:${e.llamada.destinatario}`, `sup:${e.tenant}`];
}

/**
 * Empuja las llamadas entrantes a los operadores en tiempo real (Socket.IO,
 * namespace /pbx). Autentica el handshake con el JWT; cada funcionario se une a
 * la sala de su tenant (`op:{tenant}`) y, con sesión institucional, a su sala
 * personal (`op:{tenant}:{username}`).
 *
 * Cuando la central (ACD) ya dirigió la llamada a un operador puntual, el aviso
 * va a su sala personal y a la de supervisión — en los demás puestos ni timbra,
 * igual que un teléfono de escritorio real no suena en el puesto de al lado.
 * Sin esa información (central sin ACD, extensión que no existe, o extensión de
 * un funcionario desactivado: `buscarPorExtension` solo resuelve los activos),
 * se difunde a todo el tenant — una llamada sin dueño no puede quedarse sin
 * que nadie la vea.
 *
 * Quién se entera de qué vive en `salasDelEvento`, aparte y probada: es la
 * misma regla que aplica `PbxService.listar` al refrescar, y separarlas fue lo
 * que hizo que la cola se viera distinta antes y después de un F5.
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
    this.pbx.eventos$.subscribe((evento) => {
      // Varias salas en un solo emit: socket.io no duplica el envío a un socket
      // que esté en más de una (el supervisor dueño de la extensión, por ejemplo).
      this.server
        .to(salasDelEvento(evento))
        .emit(evento.tipo === 'entrante' ? 'llamada:entrante' : 'llamada:cambio', evento.llamada);
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
        // La supervisión ve también las llamadas dirigidas a otros puestos, en
        // vivo y no solo al refrescar.
        if (esSupervisor(user)) client.join(`sup:${tenant}`);
      } else client.disconnect();
    } catch {
      client.disconnect();
    }
  }
}
