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

  /** GET /api/metricas — resumen de casos del tenant (30 días hasta hoy si no se pide otro rango). */
  @Get()
  resumen(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.metricas.resumen(tenant, { desde, hasta });
  }

  /** GET /api/metricas/tendencia — casos por día del período, con la serie del período anterior para comparar. */
  @Get('tendencia')
  tendencia(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.metricas.tendencia(tenant, { desde, hasta });
  }

  /** GET /api/metricas/cumplimiento — % de casos despachados dentro de la meta de su prioridad. */
  @Get('cumplimiento')
  cumplimiento(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.metricas.cumplimiento(tenant, { desde, hasta });
  }

  /** GET /api/metricas/hallazgos — lectura automática (reglas simples) de resumen/cumplimiento/tendencia. */
  @Get('hallazgos')
  hallazgos(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.metricas.hallazgos(tenant, { desde, hasta });
  }

  /** GET /api/metricas/ranking — casos tomados/cerrados por operador en el período. */
  @Get('ranking')
  ranking(@Tenant() tenant: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.metricas.ranking(tenant, { desde, hasta });
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
