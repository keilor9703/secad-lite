import { Controller, Get } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { Tenant } from '../common/tenant.decorator';
import { Roles } from '../auth/roles.decorator';

// Métricas de gestión: uso interno de funcionarios.
@Roles('operador', 'supervisor', 'admin')
@Controller('metricas')
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /** GET /api/metricas — resumen de casos del tenant. */
  @Get()
  resumen(@Tenant() tenant: string) {
    return this.metricas.resumen(tenant);
  }
}
