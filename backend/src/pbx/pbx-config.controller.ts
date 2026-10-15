import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from '../auth/auth.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { GuardarConfigPbx, PbxConfigService, VistaConfigPbx } from './pbx-config.service';
import { DescriptorProveedor } from './proveedores/proveedor';
import { catalogoProveedores } from './proveedores/registro';

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

  /**
   * GET /api/plataforma/pbx — la planta de cada instancia, sin secretos.
   *
   * Devuelve la lista entera y no una instancia a la vez: son unas pocas
   * filas, la pantalla las necesita todas para poder cambiar de instancia sin
   * ir y volver al servidor, y así se ve de un vistazo quién quedó en YACO.
   */
  @Get()
  ver(): Promise<VistaConfigPbx[]> {
    return this.config.listar();
  }

  /**
   * GET /api/plataforma/pbx/proveedores — el catálogo de plantas.
   *
   * Es lo que le permite a la pantalla dibujar el formulario sin tener ni un
   * nombre de proveedor escrito a mano: de aquí salen las etiquetas de los
   * campos, su ayuda, cuáles son secretos, qué sabe hacer cada proveedor y
   * dónde se pega la dirección del webhook en SU panel. Dar de alta un
   * proveedor nuevo no toca el frontend.
   */
  @Get('proveedores')
  proveedores(): DescriptorProveedor[] {
    return catalogoProveedores();
  }

  /**
   * POST /api/plataforma/pbx — guarda la planta de una instancia.
   *
   * Los campos secretos solo se escriben: si no vienen en el cuerpo, se
   * conserva el que había. Así se puede cambiar el proveedor o apagar la
   * integración sin tener que volver a teclear la credencial —ni que el
   * navegador la haya recibido nunca para poder reenviarla—.
   */
  @Post()
  async guardar(@Usuario() actor: JwtPayload, @Body() dto: GuardarConfigPbx) {
    const vista = await this.config.guardar(dto ?? {}, actor?.sub ?? 'desconocido');
    await this.auditoria.registrar(
      vista.tenant, actor?.sub ?? 'desconocido', 'pbx.config',
      `Planta telefónica: ${vista.proveedor}, ${vista.activo ? 'activa' : 'apagada'}`
        + (vista.credencialesPuestas.length
          ? `, credenciales: ${vista.credencialesPuestas.join(', ')}`
          : ', sin credenciales')
        + (vista.numeroEntrante ? ` · número ${vista.numeroEntrante}` : ''),
    );
    return vista;
  }
}
