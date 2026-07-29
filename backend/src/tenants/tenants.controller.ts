import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CrearTenantDto, TenantsService } from './tenants.service';
import { Roles } from '../auth/roles.decorator';

// Solo el superadmin gestiona los secads.
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

  @Patch(':id')
  cambiarActivo(@Param('id') id: string, @Body() dto: { activo: boolean }) {
    return this.tenants.cambiarActivo(id, !!dto.activo);
  }
}
