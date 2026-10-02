import { Body, Controller, Get, Post } from '@nestjs/common';
import { ElsService, TENANT_CONFIG_ELS } from './els.service';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Configuración GLOBAL del proveedor de geolocalización ELS — una sola para
 * toda la plataforma, como la del SMS. Solo el superadmin la gestiona, desde
 * el módulo de Plataforma.
 *
 * Qué tenants pueden usarla es otra decisión, y vive en las integraciones de
 * cada tenant (`els`), no aquí.
 */
@Roles('superadmin')
@Controller('plataforma/els')
export class ElsGlobalController {
  constructor(private readonly els: ElsService) {}

  @Get()
  ver() {
    return this.els.ver(TENANT_CONFIG_ELS);
  }

  @Post()
  guardar(@Usuario() actor: JwtPayload, @Body() dto: {
    baseUrl?: string | null;
    agencia?: string | null;
    clienteId?: string | null;
    clienteSecreto?: string;
    casoPorDefecto?: string | null;
    activo?: boolean;
  }) {
    return this.els.guardar(TENANT_CONFIG_ELS, dto ?? {}, actor?.sub ?? 'desconocido');
  }

  /**
   * Prueba con un número real contra el proveedor. Sin esto, la única forma de
   * saber si las credenciales quedaron bien es esperar a una emergencia.
   */
  @Post('probar')
  async probar(@Body() dto: { telefono?: string }): Promise<{ ok: boolean; mensaje: string }> {
    if (!dto?.telefono?.trim()) return { ok: false, mensaje: 'Indique un número para consultar.' };

    const u = await this.els.ubicar(dto.telefono.trim());
    if (u) {
      return {
        ok: true,
        mensaje: `El proveedor respondió con una ubicación: ${u.lat}, ${u.lng}`
          + (u.origen ? ` (origen ${u.origen})` : ''),
      };
    }
    return {
      ok: false,
      mensaje: 'El proveedor no devolvió ubicación para ese número. Puede ser normal '
        + '(el teléfono no la reporta) o un problema de credenciales: el registro del '
        + 'servidor distingue los dos casos.',
    };
  }
}
