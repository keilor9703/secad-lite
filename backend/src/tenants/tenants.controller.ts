import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ActualizarTenantDto, CrearTenantDto, TenantsService } from './tenants.service';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';

// Solo el superadmin gestiona los tenants.
@Roles('superadmin')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  @Get()
  listar() {
    return this.tenants.listar();
  }

  @Post()
  async crear(@Usuario() u: JwtPayload, @Body() dto: CrearTenantDto) {
    const t = await this.tenants.crear(dto);
    await this.auditoria.registrar(t.codigo, u.sub, 'tenant.crear', `Creó la instancia «${t.nombre}».`);
    return t;
  }

  /** Suscripción, bloqueo e integraciones habilitadas del tenant. */
  @Patch(':id')
  async actualizar(@Usuario() u: JwtPayload, @Param('id') id: string, @Body() dto: ActualizarTenantDto) {
    const t = await this.tenants.actualizar(id, dto);
    const campos = Object.keys(dto ?? {}).join(', ') || 'sin cambios';
    await this.auditoria.registrar(t.codigo, u.sub, 'tenant.actualizar', `Actualizó la instancia (${campos}).`);
    return t;
  }
}
