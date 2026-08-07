import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ActorPbx, PbxService, WebhookLlamadaDto } from './pbx.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
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

  /**
   * Quién actúa. `casos.ver_todos` (supervisión) ve y puede atender cualquier
   * llamada, esté o no dirigida a él por el ACD de la central.
   */
  private actor(usuario: JwtPayload, permisos: string[]): ActorPbx {
    return {
      username: usuario?.sub ?? 'desconocido',
      supervisor: usuario?.rol === 'superadmin' || permisos.includes('casos.ver_todos'),
    };
  }

  /** GET /api/pbx/llamadas — cola de llamadas del tenant. */
  @Permisos('pbx.usar')
  @Get('llamadas')
  listar(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[]) {
    return this.pbx.listar(tenant, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/atender — atender: crea/enlaza caso (screen-pop). */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/atender')
  atender(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.atender(tenant, id, this.actor(usuario, permisos));
  }

  /**
   * POST /api/pbx/llamadas/:id/reclamar — la toma para trabajarla en el
   * formulario de Recepción; desaparece de la cola de los demás operadores.
   */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/reclamar')
  reclamar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.reclamar(tenant, id, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/soltar — cancela el formulario: vuelve a la cola. */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/soltar')
  soltar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.soltar(tenant, id, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/vincular — enlaza la llamada con el caso ya guardado. */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/vincular')
  vincular(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: { casoId: string },
  ) {
    return this.pbx.vincular(tenant, id, dto?.casoId, this.actor(usuario, permisos));
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
