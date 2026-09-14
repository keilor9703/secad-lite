import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { GeografiaService } from './geografia.service';

/**
 * Catálogo de Colombia (departamentos/municipios): lectura abierta a
 * cualquier usuario autenticado (staff de cualquier tenant, o el
 * superadmin) — es información pública, la misma para todos, sin nada que
 * acotar por tenant.
 */
@Controller('geografia')
export class GeografiaController {
  constructor(private readonly geografia: GeografiaService) {}

  @Get('departamentos')
  departamentos() {
    return this.geografia.listarDepartamentos();
  }

  @Get('municipios')
  municipios(@Query('departamento') departamento: string) {
    if (!departamento?.trim()) throw new BadRequestException('Indique el código del departamento.');
    return this.geografia.municipiosDe(departamento.trim());
  }

  /**
   * Centroide del municipio, para centrar el mapa de Recepción. `null` si no
   * se pudo geocodificar (municipio inexistente, o Nominatim sin respuesta) —
   * el frontend cae al centro por defecto en ese caso, no es un error.
   */
  @Get('municipios/:codigoDane/centroide')
  centroide(@Param('codigoDane') codigoDane: string) {
    return this.geografia.centroideDe(codigoDane);
  }
}
