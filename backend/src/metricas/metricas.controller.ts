import { Controller, Get } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { Tenant } from '../common/tenant.decorator';
import { Permisos } from '../auth/permisos.decorator';

// Métricas de gestión: requiere el permiso metricas.ver.
@Permisos('metricas.ver')
@Controller('metricas')
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /** GET /api/metricas — resumen de casos del tenant. */
  @Get()
  resumen(@Tenant() tenant: string) {
    return this.metricas.resumen(tenant);
  }
}
