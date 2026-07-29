import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarRecursoDto, CrearRecursoDto, RecursosService } from './recursos.service';
import { Tenant } from '../common/tenant.decorator';
import { Roles } from '../auth/roles.decorator';

// Ver la flota: cualquier funcionario. Gestionarla: supervisor/admin.
@Roles('operador', 'supervisor', 'admin')
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

  @Roles('supervisor', 'admin')
  @Post()
  crear(@Tenant() tenant: string, @Body() dto: CrearRecursoDto) {
    return this.recursos.crear(tenant, dto);
  }

  @Roles('supervisor', 'admin')
  @Patch(':id')
  actualizar(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarRecursoDto) {
    return this.recursos.actualizar(tenant, id, dto);
  }
}
