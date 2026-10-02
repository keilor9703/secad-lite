import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MfaService } from './mfa.service';
import { Roles } from '../roles.decorator';
import { Usuario } from '../../common/usuario.decorator';
import { JwtPayload } from '../auth.service';

/**
 * Política de doble factor de la plataforma — una sola para todas las
 * instancias, igual que la de SMS y la de geolocalización. Solo el
 * superadministrador la gestiona, desde el módulo de Plataforma.
 *
 * Que el superadministrador esté exento del 2FA es lo que hace posible esta
 * pantalla: si también dependiera del código, un fallo en el doble factor
 * dejaría la plataforma sin nadie que pudiera desactivarlo.
 */
@Roles('superadmin')
@Controller('plataforma/mfa')
export class MfaGlobalController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  ver() {
    return this.mfa.verConfig();
  }

  @Post()
  guardar(@Usuario() actor: JwtPayload, @Body() dto: { exigido?: boolean }) {
    return this.mfa.guardarConfig(dto?.exigido !== false, actor?.sub ?? 'desconocido');
  }

  /**
   * Quita el enrolamiento de un usuario: la próxima vez que entre verá otra
   * vez el QR. Es lo mínimo para atender a quien cambió de teléfono, mientras
   * no exista el flujo de recuperación completo.
   */
  @Post('restablecer/:usuarioId')
  async restablecer(@Param('usuarioId') usuarioId: string) {
    await this.mfa.restablecer(usuarioId);
    return { ok: true, mensaje: 'El usuario deberá volver a enrolar su doble factor al entrar.' };
  }
}
