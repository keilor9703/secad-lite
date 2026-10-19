import {
  Body, Controller, Get, Param, Post, UploadedFile, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ActorPbx, PbxService, WebhookLlamadaDto } from './pbx.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { PbxApiKeyGuard } from './pbx-api-key.guard';
import { PbxTenant } from './pbx-tenant.decorator';
import { PbxWebhookRechazoFilter } from './webhook-rechazo.filter';
import { PbxWebhookExitoInterceptor } from './webhook-exito.interceptor';
import { Public } from '../auth/public.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { JwtPayload } from '../auth/auth.service';
import { RequiereIntegracion } from '../tenants/integracion.decorator';
import { PbxSalienteService, ResultadoLlamar } from './pbx-saliente.service';
import { PbxCredencialesService } from './pbx-credenciales.service';
import { PbxSoftphoneService } from './pbx-softphone.service';
import { descriptor as descriptorDe } from './proveedores/registro';
import { PbxGrabacionService, VistaGrabacionRecibida } from './pbx-grabacion.service';
import { MAX_BYTES_CHUNK } from '../archivos/archivos.service';

/** Lo que deja multer en la petición. Igual que en el controlador de archivos. */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@RequiereIntegracion('pbx')
@Controller('pbx')
export class PbxController {
  constructor(
    private readonly pbx: PbxService,
    private readonly tenants: TenantsService,
    private readonly auditoria: AuditoriaAdminService,
    private readonly saliente: PbxSalienteService,
    private readonly credenciales: PbxCredencialesService,
    private readonly softphoneSvc: PbxSoftphoneService,
    private readonly grabaciones: PbxGrabacionService,
  ) {}

  /**
   * POST /api/pbx/marcar — llamar al ciudadano desde el caso.
   *
   * La central llama primero a la extensión de QUIEN PIDE (sale de su usuario,
   * nunca del cuerpo) y después al número. Es una llamada facturable que queda
   * a nombre de alguien, así que:
   *
   *  - va con el mismo permiso que atender llamadas (`pbx.usar`): devolverle la
   *    llamada a un ciudadano es parte del trabajo de quien recepciona, y un
   *    permiso aparte que nadie tendría dejaría la función muerta;
   *  - cada intento queda en la bitácora de administración, con el número;
   *  - y se acota la frecuencia: diez por minuto alcanzan de sobra para una
   *    sala de despacho y evitan que un botón repetido o un script gasten la
   *    cuenta del municipio.
   */
  @Permisos('pbx.usar')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('marcar')
  async marcar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @Body() dto: { numero?: string; casoId?: string },
  ): Promise<ResultadoLlamar> {
    const actor = usuario?.sub ?? 'desconocido';
    const r = await this.saliente.marcar(tenant, actor, dto ?? {});
    await this.auditoria.registrar(
      tenant, actor, 'pbx.marcar',
      `Llamada saliente a ${r.numero ?? dto?.numero ?? '(sin número)'}`
        + (r.extension ? ` desde la extensión ${r.extension}` : '')
        + (dto?.casoId ? ` · caso ${dto.casoId}` : '')
        + (r.ok ? '' : ` — NO se pudo: ${r.mensaje}`),
    );
    return r;
  }

  /**
   * POST /api/pbx/webhook — la planta telefónica notifica timbre/colgada.
   * Público: se autentica con la API key del tenant en el header `x-api-key`,
   * verificada por `PbxApiKeyGuard` ANTES de que el `ValidationPipe` valide
   * el body (por eso el guard va primero en la lista de decoradores: así es
   * también el orden real en que Nest los ejecuta).
   */
  @Public()
  @UseGuards(PbxApiKeyGuard)
  @UseFilters(PbxWebhookRechazoFilter)
  @UseInterceptors(PbxWebhookExitoInterceptor)
  @Post('webhook')
  webhook(@PbxTenant() tenant: TenantEntity, @Body() dto: WebhookLlamadaDto) {
    return this.pbx.webhook(tenant, dto);
  }

  /**
   * POST /api/pbx/grabacion — la planta sube la grabación de una llamada.
   *
   * Autenticada con la API key de la instancia, igual que el webhook: es la
   * misma central hablando por el mismo camino. No lleva sesión de usuario
   * porque no hay ninguna persona detrás —la manda `MixMonitor` al terminar
   * de grabar—.
   *
   * La grabación queda como archivo del CASO, con `origen = GRABACION`, así
   * que hereda el permiso `casos.ver_grabaciones`, el archivado, el hash y la
   * custodia que ya rigen para las grabaciones de videollamada. Ver
   * `PbxGrabacionService` para las dos negativas que son situaciones normales.
   */
  @Public()
  @UseGuards(PbxApiKeyGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES_CHUNK } }))
  @Post('grabacion')
  grabacion(
    @PbxTenant() tenant: TenantEntity,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Body() dto: { callId?: string; segundos?: string },
  ): Promise<VistaGrabacionRecibida> {
    return this.grabaciones.recibir(tenant, {
      callId: dto?.callId,
      nombre: archivo?.originalname,
      tipoMime: archivo?.mimetype,
      segundos: Number(dto?.segundos) || undefined,
      contenido: archivo?.buffer,
    });
  }

  /**
   * Quién actúa. `casos.ver_todos` (supervisión) ve y puede atender cualquier
   * llamada, esté o no dirigida a él por el ACD de la central.
   */
  private actor(usuario: JwtPayload, permisos: string[]): ActorPbx {
    return {
      username: usuario?.sub ?? 'desconocido',
      supervisor: usuario?.rol === 'superadmin' || permisos.includes('casos.ver_todos'),
    };
  }

  /** GET /api/pbx/llamadas — cola de llamadas del tenant. */
  @Permisos('pbx.usar')
  @Get('llamadas')
  listar(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[]) {
    return this.pbx.listar(tenant, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/atender — atender: crea/enlaza caso (screen-pop). */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/atender')
  atender(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.atender(tenant, id, this.actor(usuario, permisos));
  }

  /**
   * POST /api/pbx/llamadas/:id/reclamar — la toma para trabajarla en el
   * formulario de Recepción; desaparece de la cola de los demás operadores.
   */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/reclamar')
  reclamar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.reclamar(tenant, id, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/soltar — cancela el formulario: vuelve a la cola. */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/soltar')
  soltar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.pbx.soltar(tenant, id, this.actor(usuario, permisos));
  }

  /** POST /api/pbx/llamadas/:id/vincular — enlaza la llamada con el caso ya guardado. */
  @Permisos('pbx.usar')
  @Post('llamadas/:id/vincular')
  vincular(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: { casoId: string },
  ) {
    return this.pbx.vincular(tenant, id, dto?.casoId, this.actor(usuario, permisos));
  }

  /**
   * GET /api/pbx/capacidades — qué puede hacer la planta de ESTA instancia.
   *
   * Lo lee el operador, no el superadmin, y por eso no trae ni una credencial:
   * solo el nombre del proveedor, si está encendido y qué sabe hacer. Con eso
   * la pantalla no ofrece lo imposible —el botón de llamar no aparece donde la
   * planta no sabe originar llamadas— en vez de dejar que el operador lo
   * descubra con un error en medio de una emergencia.
   */
  @Permisos('pbx.usar')
  @Get('capacidades')
  async capacidades(@Tenant() tenant: string) {
    const fila = await this.credenciales.configDe(tenant);
    const clave = this.credenciales.claveProveedor(fila);
    const d = descriptorDe(clave);
    return {
      proveedor: clave,
      nombre: d?.nombre ?? clave,
      activo: fila ? fila.activo : true,
      capacidades: d?.capacidades ?? [],
    };
  }

  /**
   * GET /api/pbx/softphone — con qué se registra ESTE navegador.
   *
   * Entrega la configuración del usuario de la sesión y de nadie más: la
   * extensión y la clave SIP salen de su propia cuenta, no de la petición. Y
   * no se anota en ninguna bitácora —lleva una credencial—.
   */
  @Permisos('pbx.usar')
  @Get('softphone')
  softphone(@Tenant() tenant: string, @Usuario() usuario: JwtPayload) {
    return this.softphoneSvc.configDe(tenant, usuario?.sub ?? '');
  }

  /**
   * GET /api/pbx/config — estado de la integración + ruta del webhook. La API
   * key ya no se guarda en claro (solo su digest), así que no se puede volver
   * a mostrar: se rota para obtener una nueva.
   */
  @Permisos('pbx.configurar')
  @Get('config')
  async config(@Tenant() tenant: string) {
    const apiKeyConfigurada = await this.tenants.apiKeyConfigurada(tenant);
    return { apiKeyConfigurada, webhookPath: '/api/pbx/webhook' };
  }

  /**
   * POST /api/pbx/config/rotar — regenera la API key del tenant. El texto
   * claro viaja SOLO en esta respuesta: es el único momento para copiarlo.
   */
  @Permisos('pbx.configurar')
  @Post('config/rotar')
  async rotar(@Tenant() tenant: string, @Usuario() u: JwtPayload) {
    const apiKey = await this.tenants.rotarApiKey(tenant);
    await this.auditoria.registrar(tenant, u?.sub ?? 'desconocido', 'pbx.rotar', 'Rotó la API key de la planta telefónica.');
    return { apiKey, apiKeyConfigurada: true, webhookPath: '/api/pbx/webhook' };
  }
}
