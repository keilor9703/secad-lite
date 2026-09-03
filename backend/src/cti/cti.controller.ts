import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { CtiService, EventoCtiDto } from './cti.service';
import { TenantsService } from '../tenants/tenants.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

@RequiereIntegracion('cti')
@Controller('cti')
export class CtiController {
  constructor(
    private readonly cti: CtiService,
    private readonly tenants: TenantsService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  /**
   * POST /api/cti/eventos/interaccion — el backend de la integración CTI/YACO
   * entrega un evento de interacción (llamada, WhatsApp, app ciudadana...).
   * Público: se autentica con la API key de CTI del tenant en `x-api-key`.
   * Esqueleto: valida y deja constancia del evento; la lógica de negocio
   * (crear/enlazar caso) se agrega cuando el contrato del proveedor esté
   * confirmado.
   */
  @Public()
  @Post('eventos/interaccion')
  eventoInteraccion(@Headers('x-api-key') apiKey: string, @Body() dto: EventoCtiDto) {
    return this.cti.procesarEventoInteraccion(apiKey, dto);
  }

  /**
   * GET /api/cti/config — estado de la integración. La API key no se guarda
   * en claro (solo su digest): se rota para obtener una nueva.
   */
  @Permisos('cti.configurar')
  @Get('config')
  async config(@Tenant() tenant: string) {
    const apiKeyConfigurada = await this.tenants.ctiApiKeyConfigurada(tenant);
    return { apiKeyConfigurada, webhookPath: '/api/cti/eventos/interaccion' };
  }

  /**
   * POST /api/cti/config/rotar — regenera la API key de CTI del tenant. El
   * texto claro viaja SOLO en esta respuesta.
   */
  @Permisos('cti.configurar')
  @Post('config/rotar')
  async rotar(@Tenant() tenant: string, @Usuario() u: JwtPayload) {
    const apiKey = await this.tenants.rotarCtiApiKey(tenant);
    await this.auditoria.registrar(tenant, u?.sub ?? 'desconocido', 'cti.rotar', 'Rotó la API key de la integración CTI/YACO.');
    return { apiKey, apiKeyConfigurada: true, webhookPath: '/api/cti/eventos/interaccion' };
  }
}
