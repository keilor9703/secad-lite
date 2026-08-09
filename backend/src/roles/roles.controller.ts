import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarRolDto, CrearRolDto, RolesService } from './roles.service';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';

/**
 * Gestión de roles y permisos (requiere el permiso roles.gestionar). Los roles
 * son por tenant: un admin edita los de su propio tenant y el superadmin los
 * del tenant en gestión que tenga elegido (ver el decorador @Tenant).
 */
@Permisos('roles.gestionar')
@Controller('roles')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  /** GET /api/roles/catalogo — permisos disponibles (filas de la matriz). */
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
  async crear(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Body() dto: CrearRolDto) {
    const rol = await this.roles.crear(tenant, dto);
    await this.auditoria.registrar(tenant, u.sub, 'rol.crear', `Creó el rol «${rol.nombre}».`);
    return rol;
  }

  /** PATCH /api/roles/:id — renombrar / cambiar la matriz de permisos. */
  @Patch(':id')
  async actualizar(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Param('id') id: string, @Body() dto: ActualizarRolDto) {
    const rol = await this.roles.actualizar(tenant, id, dto);
    const que = dto?.permisos !== undefined
      ? `permisos del rol «${rol.nombre}» → [${(rol.permisos ?? []).join(', ')}]`
      : `rol «${rol.nombre}»`;
    await this.auditoria.registrar(tenant, u.sub, 'rol.actualizar', `Actualizó ${que}.`);
    return rol;
  }

  /** DELETE /api/roles/:id — eliminar un rol a medida (no de sistema ni en uso). */
  @Delete(':id')
  async eliminar(@Tenant() tenant: string, @Usuario() u: JwtPayload, @Param('id') id: string) {
    const resultado = await this.roles.eliminar(tenant, id);
    await this.auditoria.registrar(tenant, u.sub, 'rol.eliminar', `Eliminó el rol ${id}.`);
    return resultado;
  }
}
