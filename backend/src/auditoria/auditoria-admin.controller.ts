import { Controller, Get, Query } from '@nestjs/common';
import { AuditoriaAdminService } from './auditoria-admin.service';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';

@Controller('admin')
export class AuditoriaAdminController {
  constructor(private readonly auditoria: AuditoriaAdminService) {}

  /** GET /api/admin/bitacora — quién cambió qué en la administración del tenant. */
  @Permisos('usuarios.gestionar')
  @Get('bitacora')
  listar(@Tenant() tenant: string, @Query('limite') limite?: string) {
    return this.auditoria.listar(tenant, limite ? Number(limite) : undefined);
  }
}
