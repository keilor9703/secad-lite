import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Usuario } from '../common/usuario.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { SoporteService } from './soporte.service';
import { TicketDto } from './dto/ticket.dto';

@Controller('soporte')
export class SoporteController {
  constructor(private readonly soporte: SoporteService) {}

  /**
   * POST /api/soporte/ticket — reportar un problema a la mesa de ayuda.
   *
   * Sin `@Roles` ni `@Permisos`: cualquiera con sesión puede reportar, y eso
   * es el punto. Quien ve el error es el operador en el turno, no el
   * administrador; exigir un permiso para avisar de una falla garantiza que la
   * falla la reporte alguien que no la vio, o nadie.
   *
   * Con tope de intentos porque manda dos correos por llamada: sin él, una
   * sesión válida es una forma de mandar correo con el membrete de FALCON CAD
   * a dos direcciones conocidas, todas las veces que quiera. Cinco cada diez
   * minutos deja reportar varias fallas de una tanda y corta el abuso. La
   * cuenta es por IP, así que una sala entera detrás del mismo NAT comparte el
   * tope: para el uso real —un reporte por incidente— alcanza de sobra.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('ticket')
  ticket(@Usuario() actor: JwtPayload, @Body() dto: TicketDto) {
    return this.soporte.abrir(actor, dto);
  }
}
