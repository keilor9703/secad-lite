import { Body, Controller, Get, Post } from '@nestjs/common';
import { SmsService } from './sms.service';
import { ProveedorSms } from './config-sms.entity';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Configuración del proveedor de SMS de la instancia. Es configuración
 * sensible: se administra con el mismo permiso que el resto de la
 * administración del secad.
 *
 * La credencial NUNCA se devuelve, ni enmascarada: solo se dice si la hay.
 */
@Permisos('catalogos.gestionar')
@Controller('config-sms')
export class ConfigSmsController {
  constructor(private readonly sms: SmsService) {}

  @Get()
  ver(@Tenant() tenant: string) {
    return this.sms.ver(tenant);
  }

  @Post()
  guardar(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Body() dto: {
      proveedor?: ProveedorSms;
      apiKey?: string;
      baseUrl?: string | null;
      sender?: string | null;
      activo?: boolean;
    },
  ) {
    return this.sms.guardar(tenant, dto ?? {}, actor?.sub ?? 'desconocido');
  }

  /**
   * Envía un SMS de prueba al número que indique el administrador. Sin esto,
   * la única forma de saber si las credenciales sirven sería abrir una
   * videollamada real con un ciudadano real.
   */
  @Post('probar')
  async probar(
    @Tenant() tenant: string,
    @Body() dto: { numero?: string },
  ): Promise<{ ok: boolean; mensaje: string }> {
    if (!dto?.numero?.trim()) return { ok: false, mensaje: 'Indique un número de destino.' };

    const ok = await this.sms.enviar(
      tenant, dto.numero.trim(),
      'FALCON CAD: mensaje de prueba. Si lo recibió, el envío de SMS está bien configurado.',
    );
    return {
      ok,
      mensaje: ok
        ? 'El proveedor aceptó el mensaje. Confirme que llegó al celular.'
        : 'El proveedor no aceptó el mensaje. Revise credenciales y host en el registro del servidor.',
    };
  }
}
