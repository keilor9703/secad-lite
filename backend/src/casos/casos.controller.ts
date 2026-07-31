import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CasosService } from './casos.service';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { AgregarNotaDto } from './dto/agregar-nota.dto';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Permisos } from '../auth/permisos.decorator';

// La bandeja y el detalle son de uso interno: gobernado por permisos del rol.
@Permisos('casos.ver')
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

  /** GET /api/casos/:id/auditoria — línea de tiempo del caso. */
  @Get(':id/auditoria')
  auditoria(@Tenant() tenant: string, @Param('id') id: string) {
    return this.casos.listarAuditoria(tenant, id);
  }

  /** POST /api/casos — recepcionar un caso nuevo (creador tomado del JWT). */
  @Permisos('casos.crear')
  @Post()
  crear(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Body() dto: CrearCasoDto) {
    return this.casos.crear(tenant, dto, usuario?.sub ?? 'desconocido');
  }

  /** POST /api/casos/:id/notas — agregar una nota a la bitácora. */
  @Permisos('casos.gestionar')
  @Post(':id/notas')
  agregarNota(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AgregarNotaDto,
  ) {
    return this.casos.agregarNota(tenant, id, dto?.texto, usuario?.sub ?? 'desconocido');
  }

  /** PATCH /api/casos/:id/estado — avanzar el ciclo de vida / derivar. */
  @Permisos('casos.gestionar')
  @Patch(':id/estado')
  cambiarEstado(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
  ) {
    return this.casos.cambiarEstado(tenant, id, dto, {
      sub: usuario?.sub ?? 'desconocido',
      rol: usuario?.rol ?? 'operador',
      permisos: usuario?.permisos ?? [],
    });
  }
}
