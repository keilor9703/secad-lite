import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappService } from './whatsapp.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

@RequiereIntegracion('whatsapp')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly wa: WhatsappService,
    private readonly tenants: TenantsService,
    private readonly config: ConfigService,
  ) {}

  private get verifyToken(): string {
    return this.config.get<string>('WHATSAPP_VERIFY_TOKEN', 'falcon-cad');
  }

  /**
   * GET /api/whatsapp/webhook — verificación del webhook de Meta.
   * Devuelve el `hub.challenge` si el `hub.verify_token` coincide.
   */
  @Public()
  @Get('webhook')
  verificar(@Query() q: Record<string, string>): string {
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === this.verifyToken) {
      return q['hub.challenge'];
    }
    throw new ForbiddenException('Verificación fallida.');
  }

  /** POST /api/whatsapp/webhook — mensajes entrantes de Meta. */
  @Public()
  @Post('webhook')
  async recibir(@Body() payload: any) {
    await this.wa.recibir(payload);
    return { received: true };
  }

  /** GET /api/whatsapp/config — estado de la integración. */
  @Permisos('whatsapp.configurar')
  @Get('config')
  async getConfig(@Tenant() tenant: string) {
    const cfg = await this.tenants.getWaConfig(tenant);
    return { ...cfg, verifyToken: this.verifyToken, webhookPath: '/api/whatsapp/webhook' };
  }

  /** PUT /api/whatsapp/config — configurar phone_number_id y token. */
  @Permisos('whatsapp.configurar')
  @Put('config')
  async setConfig(@Tenant() tenant: string, @Body() dto: { phoneNumberId?: string; accessToken?: string }) {
    const cfg = await this.tenants.setWaConfig(tenant, dto?.phoneNumberId, dto?.accessToken);
    return { ...cfg, verifyToken: this.verifyToken, webhookPath: '/api/whatsapp/webhook' };
  }

  /** GET /api/whatsapp/casos/:id/mensajes — conversación del caso. */
  @Permisos('whatsapp.responder')
  @Get('casos/:id/mensajes')
  mensajes(@Tenant() tenant: string, @Param('id') id: string) {
    return this.wa.historial(tenant, id);
  }

  /** POST /api/whatsapp/casos/:id/responder — el operador responde al ciudadano. */
  @Permisos('whatsapp.responder')
  @Post('casos/:id/responder')
  responder(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Param('id') id: string, @Body() dto: { texto: string }) {
    return this.wa.responder(tenant, id, dto?.texto, usuario?.sub ?? 'operador');
  }
}
