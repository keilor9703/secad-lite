import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AlcanceRecursos, ActualizarRecursoDto, CrearRecursoDto, RecursosService } from './recursos.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { JwtPayload } from '../auth/auth.service';

// Ver la flota: recursos.ver. Gestionarla (alta/edición): recursos.gestionar.
@Permisos('recursos.ver')
@Controller('recursos')
export class RecursosController {
  constructor(private readonly recursos: RecursosService) {}

  /**
   * Quien administra el secad (superadmin, o quien tiene usuarios.gestionar /
   * roles.gestionar en el tenant) ve y gestiona toda la flota; cualquier otro
   * queda acotado a la agencia de su propio usuario.
   */
  private alcance(usuario?: JwtPayload, permisos: string[] = []): AlcanceRecursos {
    const irrestricto = usuario?.rol === 'superadmin'
      || permisos.includes('*') || permisos.includes('usuarios.gestionar') || permisos.includes('roles.gestionar');
    return { irrestricto, agenciaId: usuario?.agencia ?? null };
  }

  @Get()
  listar(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[]) {
    return this.recursos.listar(tenant, this.alcance(usuario, permisos));
  }

  @Get('disponibles')
  disponibles(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[]) {
    return this.recursos.disponibles(tenant, this.alcance(usuario, permisos));
  }

  @Permisos('recursos.gestionar')
  @Post()
  crear(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Body() dto: CrearRecursoDto,
  ) {
    return this.recursos.crear(tenant, dto, this.alcance(usuario, permisos));
  }

  @Permisos('recursos.gestionar')
  @Patch(':id')
  actualizar(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Param('id') id: string, @Body() dto: ActualizarRecursoDto,
  ) {
    return this.recursos.actualizar(tenant, id, dto, this.alcance(usuario, permisos));
  }

  /** Borrado definitivo; falla con 409 si el recurso ya fue despachado. */
  @Permisos('recursos.gestionar')
  @Delete(':id')
  eliminar(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[], @Param('id') id: string) {
    return this.recursos.eliminar(tenant, id, this.alcance(usuario, permisos));
  }
}
