import { Controller, Get, Query } from '@nestjs/common';
import { PlataformaService } from './plataforma.service';
import { InfraestructuraService } from './infraestructura.service';
import { Roles } from '../auth/roles.decorator';

/**
 * Monitoreo de la plataforma: la vista del dueño de FALCON CAD sobre su propio
 * sistema — salud, infraestructura, cartera de instancias, uso real y adopción
 * de los módulos contratados.
 *
 * Reservado al superadmin, igual que TenantsController. A propósito NO usa el
 * decorador `@Tenant()`: aquí no se mira una instancia sino todas, y ese
 * decorador exige que el superadmin tenga una elegida en la barra superior.
 */
@Roles('superadmin')
@Controller('plataforma')
export class PlataformaController {
  constructor(
    private readonly plataforma: PlataformaService,
    private readonly infra: InfraestructuraService,
  ) {}

  /** GET /api/plataforma/salud — API, base de datos y Redis. */
  @Get('salud')
  salud() {
    return this.infra.salud();
  }

  /** GET /api/plataforma/infraestructura — CPU, memoria, disco y proceso. */
  @Get('infraestructura')
  infraestructura() {
    return this.infra.infraestructura();
  }

  /** GET /api/plataforma/cartera — instancias por estado, y lo que hay que atender. */
  @Get('cartera')
  cartera() {
    return this.plataforma.cartera();
  }

  /** GET /api/plataforma/uso — volumen diario, totales y ranking de instancias. */
  @Get('uso')
  uso() {
    return this.plataforma.uso();
  }

  /** GET /api/plataforma/adopcion — módulos contratados frente a módulos usados. */
  @Get('adopcion')
  adopcion() {
    return this.plataforma.adopcion();
  }

  /** GET /api/plataforma/bitacora — movimientos administrativos de todas las instancias. */
  @Get('bitacora')
  bitacora(@Query('limite') limite?: string) {
    return this.plataforma.bitacoraGlobal(limite ? Number(limite) : undefined);
  }
}
