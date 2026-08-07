import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ActualizarAgenciaDto, ActualizarCanalDto, ActualizarCodigoCasoDto, ActualizarCodigoCierreDto,
  CatalogosService, CrearAgenciaDto, CrearCanalDto, CrearCodigoCasoDto, CrearCodigoCierreDto,
} from './catalogos.service';
import { Permisos } from '../auth/permisos.decorator';
import { Tenant } from '../common/tenant.decorator';

/**
 * Catálogos del secad. Leer solo exige poder ver casos (recepción y despacho
 * los necesitan a diario); crear o modificar exige catalogos.gestionar.
 */
@Permisos('casos.ver')
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  // --- Agencias ---------------------------------------------------------------

  @Get('agencias')
  agencias(@Tenant() tenant: string, @Query('activas') activas?: string) {
    return this.catalogos.listarAgencias(tenant, activas === 'true');
  }

  @Permisos('catalogos.gestionar')
  @Post('agencias')
  crearAgencia(@Tenant() tenant: string, @Body() dto: CrearAgenciaDto) {
    return this.catalogos.crearAgencia(tenant, dto);
  }

  @Permisos('catalogos.gestionar')
  @Patch('agencias/:id')
  actualizarAgencia(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarAgenciaDto) {
    return this.catalogos.actualizarAgencia(tenant, id, dto);
  }

  @Permisos('catalogos.gestionar')
  @Delete('agencias/:id')
  desactivarAgencia(@Tenant() tenant: string, @Param('id') id: string) {
    return this.catalogos.desactivarAgencia(tenant, id);
  }

  // --- Canales de atención ----------------------------------------------------

  @Get('canales')
  canales(@Tenant() tenant: string, @Query('agencia') agencia?: string, @Query('activos') activos?: string) {
    return this.catalogos.listarCanales(tenant, agencia, activos === 'true');
  }

  @Permisos('catalogos.gestionar')
  @Post('canales')
  crearCanal(@Tenant() tenant: string, @Body() dto: CrearCanalDto) {
    return this.catalogos.crearCanal(tenant, dto);
  }

  @Permisos('catalogos.gestionar')
  @Patch('canales/:id')
  actualizarCanal(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarCanalDto) {
    return this.catalogos.actualizarCanal(tenant, id, dto);
  }

  @Permisos('catalogos.gestionar')
  @Delete('canales/:id')
  desactivarCanal(@Tenant() tenant: string, @Param('id') id: string) {
    return this.catalogos.desactivarCanal(tenant, id);
  }

  // --- Códigos de caso --------------------------------------------------------

  @Get('codigos-caso')
  codigos(@Tenant() tenant: string, @Query('activos') activos?: string) {
    return this.catalogos.listarCodigos(tenant, activos === 'true');
  }

  @Permisos('catalogos.gestionar')
  @Post('codigos-caso')
  crearCodigo(@Tenant() tenant: string, @Body() dto: CrearCodigoCasoDto) {
    return this.catalogos.crearCodigo(tenant, dto);
  }

  @Permisos('catalogos.gestionar')
  @Patch('codigos-caso/:id')
  actualizarCodigo(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarCodigoCasoDto) {
    return this.catalogos.actualizarCodigo(tenant, id, dto);
  }

  @Permisos('catalogos.gestionar')
  @Delete('codigos-caso/:id')
  desactivarCodigo(@Tenant() tenant: string, @Param('id') id: string) {
    return this.catalogos.desactivarCodigo(tenant, id);
  }

  // --- Códigos de cierre ------------------------------------------------------

  @Get('codigos-cierre')
  cierres(@Tenant() tenant: string, @Query('activos') activos?: string) {
    return this.catalogos.listarCierres(tenant, activos === 'true');
  }

  @Permisos('catalogos.gestionar')
  @Post('codigos-cierre')
  crearCierre(@Tenant() tenant: string, @Body() dto: CrearCodigoCierreDto) {
    return this.catalogos.crearCierre(tenant, dto);
  }

  @Permisos('catalogos.gestionar')
  @Patch('codigos-cierre/:id')
  actualizarCierre(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: ActualizarCodigoCierreDto) {
    return this.catalogos.actualizarCierre(tenant, id, dto);
  }

  @Permisos('catalogos.gestionar')
  @Delete('codigos-cierre/:id')
  desactivarCierre(@Tenant() tenant: string, @Param('id') id: string) {
    return this.catalogos.desactivarCierre(tenant, id);
  }
}
