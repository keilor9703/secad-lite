import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ActualizarEntidadDto, CrearEntidadDto, IntegracionService, RadicarCasoDto } from './integracion.service';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';

/**
 * API entrante para entidades externas + gestión de entidades del tenant.
 * Los endpoints públicos se autentican con la API key de la entidad.
 */
@RequiereIntegracion('api')
@Controller()
export class IntegracionController {
  constructor(
    private readonly integracion: IntegracionService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

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
  async crear(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Body() dto: CrearEntidadDto) {
    const e = await this.integracion.crear(tenant, dto);
    await this.auditoria.registrar(tenant, u.sub, 'entidad.crear', `Registró la entidad externa «${e.nombre}».`);
    return e;
  }

  /** PATCH /api/entidades/:id — renombrar / activar / desactivar. */
  @Permisos('entidades.gestionar')
  @Patch('entidades/:id')
  async actualizar(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Param('id') id: string, @Body() dto: ActualizarEntidadDto) {
    const e = await this.integracion.actualizar(tenant, id, dto);
    await this.auditoria.registrar(tenant, u.sub, 'entidad.actualizar', `Actualizó la entidad «${e.nombre}».`);
    return e;
  }

  /** POST /api/entidades/:id/rotar — regenerar la API key de la entidad. */
  @Permisos('entidades.gestionar')
  @Post('entidades/:id/rotar')
  async rotar(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Param('id') id: string) {
    const e = await this.integracion.rotarKey(tenant, id);
    await this.auditoria.registrar(tenant, u.sub, 'entidad.rotar', `Rotó la API key de la entidad «${e.nombre}».`);
    return e;
  }
}
