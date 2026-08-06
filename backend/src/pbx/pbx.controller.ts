import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

@RequiereIntegracion('pbx')
@Controller('pbx')
export class PbxController {
  constructor(
    private readonly pbx: PbxService,
    private readonly tenants: TenantsService,
  ) {}

  /**
   * POST /api/pbx/webhook — la planta telefónica notifica timbre/colgada.
   * Público: se autentica con la API key del tenant en el header `x-api-key`.
   */
  @Public()
  @Post('webhook')
  webhook(@Headers('x-api-key') apiKey: string, @Body() dto: WebhookLlamadaDto) {
    return this.pbx.webhook(apiKey, dto);
  }

  /** GET /api/pbx/llamadas — cola de llamadas del tenant. */
  @Permisos('pbx.usar')
  @Get('llamadas')
  listar(@Tenant() tenant: string) {
    return this.pbx.listar(tenant);
  }

  /** POST /api/pbx/llamadas/:id/atender — atender: crea/enlaza caso (screen-pop). */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/atender')
  atender(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Param('id') id: string) {
    return this.pbx.atender(tenant, id, usuario?.sub ?? 'desconocido');
  }

  /** GET /api/pbx/config — API key del tenant + ruta del webhook. */
  @Permisos('pbx.configurar')
  @Get('config')
  async config(@Tenant() tenant: string) {
    const apiKey = await this.tenants.apiKeyDe(tenant);
    return { apiKey, webhookPath: '/api/pbx/webhook' };
  }

  /** POST /api/pbx/config/rotar — regenera la API key del tenant. */
  @Permisos('pbx.configurar')
  @Post('config/rotar')
  async rotar(@Tenant() tenant: string) {
    const apiKey = await this.tenants.rotarApiKey(tenant);
    return { apiKey, webhookPath: '/api/pbx/webhook' };
  }
}
