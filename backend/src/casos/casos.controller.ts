import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CasosService } from './casos.service';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { Tenant } from '../common/tenant.decorator';

@Controller('casos')
export class CasosController {
  constructor(private readonly casos: CasosService) {}

  /** GET /api/casos — bandeja de recepción del tenant. */
  @Get()
  listar(@Tenant() tenant: string) {
    return this.casos.listar(tenant);
  }

  /** GET /api/casos/:id */
  @Get(':id')
  obtener(@Tenant() tenant: string, @Param('id') id: string) {
    return this.casos.obtener(tenant, id);
  }

  /** POST /api/casos — recepcionar un caso nuevo. */
  @Post()
  crear(@Tenant() tenant: string, @Body() dto: CrearCasoDto) {
    // En el mock, el usuario creador es fijo; en producción sale del JWT.
    return this.casos.crear(tenant, dto, 'operador');
  }

  /** PATCH /api/casos/:id/estado — avanzar el ciclo de vida / derivar. */
  @Patch(':id/estado')
  cambiarEstado(@Tenant() tenant: string, @Param('id') id: string, @Body() dto: CambiarEstadoDto) {
    return this.casos.cambiarEstado(tenant, id, dto);
  }
}
