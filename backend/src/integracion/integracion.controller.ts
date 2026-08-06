import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ActualizarEntidadDto, CrearEntidadDto, IntegracionService, RadicarCasoDto } from './integracion.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

/**
 * API entrante para entidades externas + gestión de entidades del tenant.
 * Los endpoints públicos se autentican con la API key de la entidad.
 */
@RequiereIntegracion('api')
@Controller()
export class IntegracionController {
  constructor(private readonly integracion: IntegracionService) {}

  /** POST /api/integracion/casos — una entidad externa radica un caso. */
  @Public()
  @Post('integracion/casos')
  radicar(@Headers('x-api-key') apiKey: string, @Body() dto: RadicarCasoDto) {
    return this.integracion.radicar(apiKey, dto);
  }

  /** GET /api/integracion/casos/:id — la entidad consulta el estado de SU caso. */
  @Public()
  @Get('integracion/casos/:id')
  consultar(@Headers('x-api-key') apiKey: string, @Param('id') id: string) {
    return this.integracion.consultar(apiKey, id);
  }

  // --- Gestión de entidades (Administración) --------------------------------

  /** GET /api/entidades — entidades del tenant (con su API key). */
  @Permisos('entidades.gestionar')
  @Get('entidades')
  listar(@Tenant() tenant: string) {
    return this.integracion.listar(tenant);
  }

  /** POST /api/entidades — registrar una entidad (genera su API key). */
  @Permisos('entidades.gestionar')
  @Post('entidades')
  crear(@Tenant() tenant: string, @Body() dto: CrearEntidadDto) {
    return this.integracion.crear(tenant, dto);
  }

  /** PATCH /api/entidades/:id — renombrar / activar / desactivar. */
  @Permisos('entidades.gestionar')
  @Patch('entidades/:id')
  actualizar(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarEntidadDto) {
    return this.integracion.actualizar(tenant, id, dto);
  }

  /** POST /api/entidades/:id/rotar — regenerar la API key de la entidad. */
  @Permisos('entidades.gestionar')
  @Post('entidades/:id/rotar')
  rotar(@Tenant() tenant: string, @Param('id') id: string) {
    return this.integracion.rotarKey(tenant, id);
  }
}
