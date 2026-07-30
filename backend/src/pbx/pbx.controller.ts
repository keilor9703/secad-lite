import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { PbxService, WebhookLlamadaDto } from './pbx.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';

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

  /** GET /api/pbx/llamadas — cola de llamadas del tenant (funcionarios). */
  @Roles('operador', 'supervisor', 'admin')
  @Get('llamadas')
  listar(@Tenant() tenant: string) {
    return this.pbx.listar(tenant);
  }

  /** POST /api/pbx/llamadas/:id/atender — atender: crea/enlaza caso (screen-pop). */
  @Roles('operador', 'supervisor', 'admin')
  @Post('llamadas/:id/atender')
  atender(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Param('id') id: string) {
    return this.pbx.atender(tenant, id, usuario?.sub ?? 'desconocido');
  }

  /** GET /api/pbx/config — API key del tenant + ruta del webhook (para configurar la PBX). */
  @Roles('supervisor', 'admin')
  @Get('config')
  async config(@Tenant() tenant: string) {
    const apiKey = await this.tenants.apiKeyDe(tenant);
    return { apiKey, webhookPath: '/api/pbx/webhook' };
  }

  /** POST /api/pbx/config/rotar — regenera la API key del tenant (admin). */
  @Roles('admin')
  @Post('config/rotar')
  async rotar(@Tenant() tenant: string) {
    const apiKey = await this.tenants.rotarApiKey(tenant);
    return { apiKey, webhookPath: '/api/pbx/webhook' };
  }
}
