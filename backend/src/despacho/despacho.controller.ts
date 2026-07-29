import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DespachoService } from './despacho.service';
import { EstadoAsignacion } from './asignacion.entity';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';

// Despacho: cualquier funcionario puede despachar y hacer avanzar recursos.
@Roles('operador', 'supervisor', 'admin')
@Controller()
export class DespachoController {
  constructor(private readonly despacho: DespachoService) {}

  /** GET /api/casos/:id/asignaciones — recursos despachados al caso. */
  @Get('casos/:id/asignaciones')
  listar(@Tenant() tenant: string, @Param('id') casoId: string) {
    return this.despacho.listar(tenant, casoId);
  }

  /** POST /api/casos/:id/asignaciones — despachar un recurso al caso. */
  @Post('casos/:id/asignaciones')
  asignar(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') casoId: string,
    @Body() dto: { recursoId: string },
  ) {
    return this.despacho.asignar(tenant, casoId, dto?.recursoId, actor?.sub ?? 'desconocido');
  }

  /** PATCH /api/asignaciones/:id/estado — avanzar/cerrar el despacho. */
  @Patch('asignaciones/:id/estado')
  cambiarEstado(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') asignacionId: string,
    @Body() dto: { estado: EstadoAsignacion; motivo?: string },
  ) {
    return this.despacho.cambiarEstado(tenant, asignacionId, dto?.estado, actor?.sub ?? 'desconocido', dto?.motivo);
  }
}
