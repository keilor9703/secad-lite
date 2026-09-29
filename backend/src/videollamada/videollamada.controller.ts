import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { VideollamadaService } from './videollamada.service';
import { VideoTokenService } from './video-token.service';
import { ArchivosService } from '../archivos/archivos.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { Permisos } from '../auth/permisos.decorator';
import { Public } from '../auth/public.decorator';
import { JwtPayload } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Videollamada con el ciudadano. La abre el despachador desde el caso; el
 * ciudadano solo recibe un enlace y nunca llama a nada autenticado de aquí
 * —su único endpoint es el público, que valida el enlace antes de pedirle
 * permiso de cámara—.
 *
 * El permiso se declara MÉTODO A MÉTODO, como en el resto de los
 * controladores. A nivel de clase, `PermisosGuard` lo exigiría también en la
 * ruta del ciudadano: ese guardia resuelve los permisos contra la base y no
 * mira `@Public()`, así que la clase entera se volvía inalcanzable sin sesión
 * y el enlace respondía 403.
 */
@Controller()
export class VideollamadaController {
  constructor(
    private readonly video: VideollamadaService,
    private readonly tokens: VideoTokenService,
    private readonly archivos: ArchivosService,
    private readonly tenants: TenantsService,
  ) {}

  /** POST /api/casos/:id/videollamada — abrir la llamada y mandar el enlace. */
  @Permisos('despacho.ver')
  @Post('casos/:id/videollamada')
  async crear(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') casoId: string,
    @Body() dto: { numeroTelefono?: string; baseUrl?: string },
  ) {
    const t = await this.tenants.porCodigo(tenant);
    if (t) this.tenants.asegurarVigente(t, 'videollamada');

    return this.video.crear(
      tenant, casoId, dto?.numeroTelefono ?? '', actor?.sub ?? 'desconocido', dto?.baseUrl);
  }

  /**
   * GET /api/casos/:id/videollamada/activa — ¿hay una en curso?
   *
   * Lo consulta el panel al abrir el caso, para ofrecer RECONECTARSE en vez de
   * generar otro enlace. Es lo que permite recuperar la llamada tras un F5, un
   * cambio de pestaña, una caída de red o un relevo de turno.
   */
  @Permisos('despacho.ver')
  @Get('casos/:id/videollamada/activa')
  async activa(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') casoId: string,
    @Query('baseUrl') baseUrl?: string,
  ) {
    const sesion = await this.video.activaDe(tenant, casoId);
    if (!sesion) return { hay: false };

    const token = this.video.tokenDe(sesion, actor?.sub ?? 'desconocido');
    return {
      hay: true,
      sesionId: sesion.id,
      estado: sesion.estado,
      token,
      enlace: this.video.enlace(token, baseUrl),
      expiraEn: sesion.expiraEn,
      grabando: !!sesion.archivoGrabacionId,
    };
  }

  /**
   * GET /api/casos/:id/videollamadas — la traza que queda cuando el caso ya se
   * cerró: quién atendió, cuándo, cuánto duró, dónde estaba el ciudadano y si
   * quedó grabación.
   */
  @Permisos('despacho.ver')
  @Get('casos/:id/videollamadas')
  listar(@Tenant() tenant: string, @Param('id') casoId: string) {
    return this.video.listarPorCaso(tenant, casoId);
  }

  /** GET /api/videollamadas/:id/chat — la transcripción del chat. */
  @Permisos('despacho.ver')
  @Get('videollamadas/:id/chat')
  chat(@Tenant() tenant: string, @Param('id') sesionId: string) {
    return this.video.listarChat(tenant, sesionId);
  }

  // ── Grabación ─────────────────────────────────────────────────────────────

  /**
   * POST /api/videollamadas/:id/grabacion — abre el archivo de la grabación.
   *
   * Se abre al EMPEZAR a grabar, no al terminar: así lo que se alcance a subir
   * queda guardado aunque el puesto del despachador muera a mitad de la
   * llamada. Los trozos van por la capa de archivos (POST /archivos/:id/chunk).
   */
  @Permisos('despacho.ver')
  @Post('videollamadas/:id/grabacion')
  async iniciarGrabacion(
    @Tenant() tenant: string,
    @Usuario() actor: JwtPayload,
    @Param('id') sesionId: string,
  ) {
    const sesion = await this.video.obtener(tenant, sesionId);
    if (!sesion) return { ok: false, mensaje: 'Videollamada no encontrada.' };

    const archivo = await this.archivos.crear(tenant, {
      casoId: sesion.casoId,
      nombre: `videollamada-${sesionId}.webm`,
      tipoMime: 'video/webm',
      usuario: actor?.sub ?? 'desconocido',
      origen: 'GRABACION',
      descripcion: 'Grabación de videollamada con el ciudadano',
      videoSesionId: sesionId,
    });

    await this.video.asociarGrabacion(tenant, sesionId, archivo.id);
    return { ok: true, archivoId: archivo.id };
  }

  // ── Lo único que toca el ciudadano ────────────────────────────────────────

  /**
   * GET /api/videollamada/publico/:token — ¿sigue sirviendo este enlace?
   *
   * La página del ciudadano lo llama ANTES de pedirle permiso de cámara y
   * micrófono: pedirle acceso a la cámara para después decirle que el enlace
   * venció sería maltratar a alguien que está en una emergencia.
   */
  @Public()
  @Get('videollamada/publico/:token')
  async validar(@Param('token') token: string) {
    const datos = this.tokens.validar(token);
    if (!datos) return { valido: false, mensaje: 'Este enlace ya no es válido o expiró.' };

    const sesion = await this.video.obtener(datos.tenant, datos.sesionId);
    if (!sesion || sesion.estado === 'FINALIZADA')
      return { valido: false, mensaje: 'Esta videollamada ya terminó.' };

    return { valido: true, sesionId: sesion.id, estado: sesion.estado };
  }
}
