import { Body, Controller, Get, Post } from '@nestjs/common';
import { SmsService, TENANT_CONFIG_SMS } from './sms.service';
import { ProveedorSms } from './config-sms.entity';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Configuración GLOBAL del proveedor de SMS — una sola para toda la plataforma.
 * Solo el superadmin la gestiona, desde el módulo de Plataforma.
 */
@Roles('superadmin')
@Controller('plataforma/sms')
export class SmsGlobalController {
  constructor(private readonly sms: SmsService) {}

  @Get()
  ver() {
    return this.sms.ver(TENANT_CONFIG_SMS);
  }

  @Post()
  guardar(@Usuario() actor: JwtPayload, @Body() dto: {
    proveedor?: ProveedorSms;
    apiKey?: string;
    baseUrl?: string | null;
    sender?: string | null;
    activo?: boolean;
  }) {
    return this.sms.guardar(TENANT_CONFIG_SMS, dto ?? {}, actor?.sub ?? 'desconocido');
  }

  @Post('probar')
  async probar(@Body() dto: { numero?: string }): Promise<{ ok: boolean; mensaje: string }> {
    if (!dto?.numero?.trim()) return { ok: false, mensaje: 'Indique un número de destino.' };
    const ok = await this.sms.enviar(dto.numero.trim(),
      'FALCON CAD: mensaje de prueba. Si lo recibió, el envío de SMS está bien configurado.');
    return {
      ok,
      mensaje: ok
        ? 'El proveedor aceptó el mensaje. Confirme que llegó al celular.'
        : 'El proveedor no aceptó el mensaje. Revise credenciales y host en el registro del servidor.',
    };
  }
}
