import { Controller, Get, Query } from '@nestjs/common';
import { ElsService, UbicacionEls } from './els.service';
import { Permisos } from '../auth/permisos.decorator';
import { RequiereIntegracion } from '../tenants/integracion.decorator';

/**
 * Geolocalización automática del llamante, para la recepción.
 *
 * `@RequiereIntegracion('els')` la apaga entera en los tenants que no la tienen
 * contratada: la consulta se le factura al operador del SaaS, así que no puede
 * dispararla cualquier municipio por tener la pantalla abierta.
 */
@RequiereIntegracion('els')
@Controller('els')
export class ElsController {
  constructor(private readonly els: ElsService) {}

  /**
   * GET /api/els/ubicacion?telefono=3224445555
   *
   * Devuelve `{ hay: false }` cuando no hay nada —sin ubicación, sin
   * configuración, proveedor caído— en vez de un error: para la recepción son
   * el mismo caso, seguir pidiendo la dirección de viva voz, y un error haría
   * saltar un aviso en pantalla en mitad de una llamada de emergencia.
   */
  @Permisos('casos.crear')
  @Get('ubicacion')
  async ubicacion(
    @Query('telefono') telefono?: string,
    @Query('caso') caso?: string,
  ): Promise<{ hay: boolean; ubicacion?: UbicacionEls }> {
    const u = telefono ? await this.els.ubicar(telefono, caso) : null;
    return u ? { hay: true, ubicacion: u } : { hay: false };
  }
}
