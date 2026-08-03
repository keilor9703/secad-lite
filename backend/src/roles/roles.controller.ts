import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ActualizarRolDto, CrearRolDto, RolesService } from './roles.service';
import { Permisos } from '../auth/permisos.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Gestión de roles y permisos (requiere el permiso roles.gestionar). Los roles
 * son por tenant: un admin gestiona los de su propio tenant —el del token— y el
 * superadmin, que no pertenece a ninguno, indica sobre cuál trabaja
 * (`?tenant=codigo`). El tenant solicitado se ignora para quien no es
 * superadmin, así nadie puede editar los roles de otro tenant.
 */
@Permisos('roles.gestionar')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** GET /api/roles/catalogo — permisos disponibles (filas de la matriz). */
  @Get('catalogo')
  catalogo() {
    return this.roles.catalogo();
  }

  /** GET /api/roles — roles del tenant con sus permisos. */
  @Get()
  listar(@Usuario() actor: JwtPayload, @Query('tenant') tenant?: string) {
    return this.roles.listar(this.tenantObjetivo(actor, tenant));
  }

  /** POST /api/roles — crear un rol a medida. */
  @Post()
  crear(@Usuario() actor: JwtPayload, @Body() dto: CrearRolDto, @Query('tenant') tenant?: string) {
    return this.roles.crear(this.tenantObjetivo(actor, tenant), dto);
  }

  /** PATCH /api/roles/:id — renombrar / cambiar la matriz de permisos. */
  @Patch(':id')
  actualizar(
    @Usuario() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarRolDto,
    @Query('tenant') tenant?: string,
  ) {
    return this.roles.actualizar(this.tenantObjetivo(actor, tenant), id, dto);
  }

  /** DELETE /api/roles/:id — eliminar un rol a medida (no de sistema ni en uso). */
  @Delete(':id')
  eliminar(@Usuario() actor: JwtPayload, @Param('id') id: string, @Query('tenant') tenant?: string) {
    return this.roles.eliminar(this.tenantObjetivo(actor, tenant), id);
  }

  /** Tenant sobre el que se opera: el del token, salvo el superadmin que lo elige. */
  private tenantObjetivo(actor: JwtPayload, solicitado?: string): string {
    if (actor.rol === 'superadmin') {
      const t = solicitado?.trim();
      if (!t) throw new BadRequestException('Indique el tenant cuyos roles va a gestionar.');
      return t;
    }
    const propio = actor.tenant?.trim();
    if (!propio) throw new BadRequestException('Su usuario no tiene un tenant asignado.');
    return propio;
  }
}
