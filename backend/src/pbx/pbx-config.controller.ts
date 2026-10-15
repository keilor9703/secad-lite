import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { PbxConfigService, VistaConfigPbx } from './pbx-config.service';
import { ProveedorPbx } from './config-pbx.entity';

/**
 * Qué planta telefónica atiende a cada instancia, y con qué credenciales.
 *
 * Reservado al superadmin: la llave de una centralita permite escuchar
 * grabaciones y originar llamadas facturables de un municipio. No es algo que
 * administre el municipio desde su propia pantalla.
 *
 * A propósito NO cuelga de `PbxController`: ese lleva
 * `@RequiereIntegracion('pbx')`, y entonces no se podría configurar la
 * telefonía de una instancia que todavía no la tiene habilitada — que es
 * exactamente el momento en que hay que configurarla.
 */
@Roles('superadmin')
@Controller('plataforma/pbx')
export class PbxConfigController {
  constructor(
    private readonly config: PbxConfigService,
    private readonly auditoria: AuditoriaAdminService,
  ) {}

  /** GET /api/plataforma/pbx?tenant=63001 — qué hay configurado (sin secretos). */
  @Get()
  ver(@Body('tenant') _sinUso: unknown, @Usuario() _actor: JwtPayload): Promise<VistaConfigPbx[]> {
    return this.config.listar();
  }

  /**
   * POST /api/plataforma/pbx — guarda la planta de una instancia.
   *
   * El secreto solo se escribe: si no viene en el cuerpo, se conserva el que
   * había. Así se puede cambiar el proveedor o apagar la integración sin
   * tener que volver a teclear la credencial —ni que el navegador la haya
   * recibido nunca para poder reenviarla—.
   */
  @Post()
  async guardar(@Usuario() actor: JwtPayload, @Body() dto: {
    tenant?: string;
    proveedor?: ProveedorPbx;
    activo?: boolean;
    zadarmaKey?: string | null;
    zadarmaSecreto?: string | null;
    numeroEntrante?: string | null;
  }) {
    const vista = await this.config.guardar(dto ?? {}, actor?.sub ?? 'desconocido');
    await this.auditoria.registrar(
      vista.tenant, actor?.sub ?? 'desconocido', 'pbx.config',
      `Planta telefónica: ${vista.proveedor}, ${vista.activo ? 'activa' : 'apagada'}`
        + (vista.tieneCredenciales ? ', con credenciales' : ', sin credenciales')
        + (vista.numeroEntrante ? ` · número ${vista.numeroEntrante}` : ''),
    );
    return vista;
  }
}
