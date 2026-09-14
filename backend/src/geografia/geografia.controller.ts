import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
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
}
