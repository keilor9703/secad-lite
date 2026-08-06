import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarTenantDto, CrearTenantDto, TenantsService } from './tenants.service';
import { Roles } from '../auth/roles.decorator';

// Solo el superadmin gestiona los tenants.
@Roles('superadmin')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  listar() {
    return this.tenants.listar();
  }

  @Post()
  crear(@Body() dto: CrearTenantDto) {
    return this.tenants.crear(dto);
  }

  /** Suscripción, bloqueo e integraciones habilitadas del tenant. */
  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarTenantDto) {
    return this.tenants.actualizar(id, dto);
  }
}
