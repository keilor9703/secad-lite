import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarRecursoDto, CrearRecursoDto, RecursosService } from './recursos.service';
import { Tenant } from '../common/tenant.decorator';
import { Permisos } from '../auth/permisos.decorator';

// Ver la flota: recursos.ver. Gestionarla (alta/edición): recursos.gestionar.
@Permisos('recursos.ver')
@Controller('recursos')
export class RecursosController {
  constructor(private readonly recursos: RecursosService) {}

  @Get()
  listar(@Tenant() tenant: string) {
    return this.recursos.listar(tenant);
  }

  @Get('disponibles')
  disponibles(@Tenant() tenant: string) {
    return this.recursos.disponibles(tenant);
  }

  @Permisos('recursos.gestionar')
  @Post()
  crear(@Tenant() tenant: string, @Body() dto: CrearRecursoDto) {
    return this.recursos.crear(tenant, dto);
  }

  @Permisos('recursos.gestionar')
  @Patch(':id')
  actualizar(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarRecursoDto) {
    return this.recursos.actualizar(tenant, id, dto);
  }

  /** Borrado definitivo; falla con 409 si el recurso ya fue despachado. */
  @Permisos('recursos.gestionar')
  @Delete(':id')
  eliminar(@Tenant() tenant: string, @Param('id') id: string) {
    return this.recursos.eliminar(tenant, id);
  }
}
