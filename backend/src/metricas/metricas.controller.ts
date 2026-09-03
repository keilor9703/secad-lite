import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
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

  /** GET /api/metricas/mapa — mapa estadístico/de calor de casos históricos. */
  @Get('mapa')
  mapa(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('codigo') codigo?: string) {
    return this.metricas.mapa(tenant, { desde, hasta, codigo });
  }

  /** GET /api/metricas/llamadas — reporte de la planta telefónica (PBX). */
  @Get('llamadas')
  llamadas(@Tenant() tenant: string) {
    return this.metricas.llamadas(tenant);
  }

  @Get('exportar')
  async exportar(
    @Tenant() tenant: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.metricas.exportarCsv(tenant, { desde, hasta, estado });
    if (res) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="casos-${tenant}-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send('\uFEFF' + csv);
    }
  }
}
