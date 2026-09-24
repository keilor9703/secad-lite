import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricasService } from './metricas.service';
import { InformePdfService } from './informe-pdf.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Permisos } from '../auth/permisos.decorator';
import { UsuariosService } from '../usuarios/usuarios.service';

// Métricas de gestión: requiere el permiso metricas.ver.
@Permisos('metricas.ver')
@Controller('metricas')
export class MetricasController {
  constructor(
    private readonly metricas: MetricasService,
    private readonly informePdf: InformePdfService,
    private readonly usuarios: UsuariosService,
  ) {}

  /**
   * A qué agencia acotar el Panel/Mapa: `undefined` (irrestricto) para
   * superadmin o quien administre la organización (usuarios.gestionar /
   * roles.gestionar) — ve todo el tenant, como siempre. Cualquier otro rol
   * con metricas.ver (p. ej. un supervisor de una sola agencia) solo ve lo
   * de la suya; sin agencia asignada, no ve nada. Mismo criterio que
   * `CasosService.irrestricto()`.
   */
  private async alcanceAgencia(usuario: JwtPayload, permisos: string[]): Promise<string | null | undefined> {
    if (usuario.rol === 'superadmin' || permisos.includes('usuarios.gestionar') || permisos.includes('roles.gestionar')) {
      return undefined;
    }
    const yo = await this.usuarios.buscarPorUsernameYTenant(usuario?.sub ?? '', usuario?.tenant ?? null);
    return yo?.agenciaId ?? null;
  }

  /** GET /api/metricas — resumen de casos del tenant (30 días hasta hoy si no se pide otro rango). */
  @Get()
  async resumen(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    return this.metricas.resumen(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/tendencia — casos por día del período, con la serie del período anterior para comparar. */
  @Get('tendencia')
  async tendencia(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    return this.metricas.tendencia(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/cumplimiento — % de casos despachados dentro de la meta de su prioridad. */
  @Get('cumplimiento')
  async cumplimiento(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    return this.metricas.cumplimiento(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/hallazgos — lectura automática (reglas simples) de resumen/cumplimiento/tendencia. */
  @Get('hallazgos')
  async hallazgos(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    return this.metricas.hallazgos(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/ranking — casos tomados/cerrados por operador en el período. */
  @Get('ranking')
  async ranking(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    return this.metricas.ranking(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/mapa — mapa estadístico/de calor de casos históricos. */
  @Get('mapa')
  async mapa(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('codigo') codigo?: string,
  ) {
    return this.metricas.mapa(tenant, { desde, hasta, codigo }, await this.alcanceAgencia(usuario, permisos));
  }

  /** GET /api/metricas/llamadas — reporte de la planta telefónica (PBX), siempre del tenant completo (ver comentario en el servicio). */
  @Get('llamadas')
  llamadas(@Tenant() tenant: string) {
    return this.metricas.llamadas(tenant);
  }

  /** GET /api/metricas/informe.pdf — el mismo resumen del Panel, en un PDF para imprimir o adjuntar. */
  @Get('informe.pdf')
  async informePdfRoute(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Res() res?: Response,
  ) {
    const doc = await this.informePdf.generar(tenant, { desde, hasta }, await this.alcanceAgencia(usuario, permisos));
    if (res) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="informe-${tenant}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      doc.pipe(res);
    }
  }

  /**
   * GET /api/metricas/detalle — los casos exactos detrás de UN valor de un
   * reporte del Panel/Mapa (doble clic sobre una barra o una fila). Un solo
   * filtro a la vez: agencia, canal, estado, prioridad (sola, para "casos
   * por prioridad"), o prioridad/hito/dentroMeta combinados (cumplimiento y
   * tiempos de respuesta, que necesitan saber CUÁNDO pasó un hito).
   */
  @Get('detalle')
  async detalle(
    @Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
    @Query('agencia') agencia?: string, @Query('canal') canal?: string, @Query('estado') estado?: string,
    @Query('prioridad') prioridad?: string, @Query('dentroMeta') dentroMeta?: string,
    @Query('hito') hito?: 'tomado' | 'despacho' | 'cierre',
  ) {
    return this.metricas.detalle(
      tenant,
      { desde, hasta, agencia, canal, estado, prioridad, dentroMeta: dentroMeta === undefined ? undefined : dentroMeta === 'true', hito },
      await this.alcanceAgencia(usuario, permisos),
    );
  }

  @Get('exportar')
  async exportar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('estado') estado?: string,
    @Res() res?: Response,
  ) {
    const csv = await this.metricas.exportarCsv(tenant, { desde, hasta, estado }, await this.alcanceAgencia(usuario, permisos));
    if (res) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="casos-${tenant}-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send('﻿' + csv);
    }
  }
}
