import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarRolDto, CrearRolDto, RolesService } from './roles.service';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';

/** Gestión de roles y permisos del tenant (requiere el permiso roles.gestionar). */
@Permisos('roles.gestionar')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** GET /api/roles/catalogo — permisos disponibles (columnas de la matriz). */
  @Get('catalogo')
  catalogo() {
    return this.roles.catalogo();
  }

  /** GET /api/roles — roles del tenant con sus permisos. */
  @Get()
  listar(@Tenant() tenant: string) {
    return this.roles.listar(tenant);
  }

  /** POST /api/roles — crear un rol a medida. */
  @Post()
  crear(@Tenant() tenant: string, @Body() dto: CrearRolDto) {
    return this.roles.crear(tenant, dto);
  }

  /** PATCH /api/roles/:id — renombrar / cambiar la matriz de permisos. */
  @Patch(':id')
  actualizar(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarRolDto) {
    return this.roles.actualizar(tenant, id, dto);
  }

  /** DELETE /api/roles/:id — eliminar un rol a medida (no de sistema ni en uso). */
  @Delete(':id')
  eliminar(@Tenant() tenant: string, @Param('id') id: string) {
    return this.roles.eliminar(tenant, id);
  }
}
