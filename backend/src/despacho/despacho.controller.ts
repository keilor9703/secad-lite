import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DespachoService } from './despacho.service';
import { EstadoAsignacion } from './asignacion.entity';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Permisos } from '../auth/permisos.decorator';

// Despacho: ver requiere despacho.ver; despachar/mover requiere despacho.asignar.
@Permisos('despacho.ver')
@Controller()
export class DespachoController {
  constructor(private readonly despacho: DespachoService) {}

  /** GET /api/casos/:id/asignaciones — recursos despachados al caso. */
  @Get('casos/:id/asignaciones')
  listar(@Tenant() tenant: string, @Param('id') casoId: string) {
    return this.despacho.listar(tenant, casoId);
  }

  /** GET /api/casos/:id/recursos-sugeridos — disponibles por cercanía + ETA. */
  @Get('casos/:id/recursos-sugeridos')
  recursosSugeridos(@Tenant() tenant: string, @Param('id') casoId: string) {
    return this.despacho.recursosSugeridos(tenant, casoId);
  }

  /** POST /api/casos/:id/asignaciones — despachar un recurso al caso. */
  @Permisos('despacho.asignar')
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
  @Permisos('despacho.asignar')
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
