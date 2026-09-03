import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Actor, CasosService } from './casos.service';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { AgregarNotaDto } from './dto/agregar-nota.dto';
import { RemitirDto } from './dto/remitir.dto';
import { RemitirTenantDto } from './dto/remitir-tenant.dto';
import { ReabrirDto, SolicitarReaperturaDto } from './dto/reabrir.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Permisos } from '../auth/permisos.decorator';
import { EstadoCaso } from './caso.model';
import { CasoEntity } from './caso.entity';

// La bandeja y el detalle son de uso interno: gobernado por permisos del rol.
@Permisos('casos.ver')
@Controller('casos')
export class CasosController {
  constructor(
    private readonly casos: CasosService,
    private readonly usuarios: UsuariosService,
  ) {}

  /**
   * Quién actúa, con sus permisos VIGENTES y los canales que atiende. Los
   * canales se consultan en el momento (no viajan en el token) para que
   * reasignarlos surta efecto sin volver a iniciar sesión.
   */
  private async actor(usuario: JwtPayload, permisos: string[]): Promise<Actor> {
    const yo = await this.usuarios.buscarPorUsernameYTenant(usuario?.sub ?? '', usuario?.tenant ?? null);
    return {
      sub: usuario?.sub ?? 'desconocido',
      rol: usuario?.rol ?? 'operador',
      permisos: permisos.includes('*') ? [] : permisos,
      canales: yo?.canales ?? [],
    };
  }

  /**
   * Las URL de grabación/transcripción (integración CTI/YACO) solo se exponen
   * a quien tenga `casos.ver_grabaciones` (despacho/supervisión) — no a
   * cualquier operador de canal. `permisos` ya vienen resueltos por
   * PermisosGuard, no por el token.
   */
  private ocultarGrabaciones<T extends CasoEntity>(caso: T, permisos: string[]): T {
    if (permisos.includes('*') || permisos.includes('casos.ver_grabaciones')) return caso;
    return { ...caso, urlGrabacion: null, urlTranscripcion: null };
  }

  /**
   * GET /api/casos — bandeja del secad.
   * Lo que devuelve depende del alcance del funcionario: con casos.ver_todos,
   * todo; sin él, solo lo de sus canales y lo que él recepcionó.
   * `?limite=` acota la tanda (200 por defecto, tope 500); `?abiertos=true`
   * excluye los cerrados (la vista del tablero de despacho).
   */
  @Get()
  async listar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Query('limite') limite?: string,
    @Query('abiertos') abiertos?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const casos = await this.casos.listar(tenant, await this.actor(usuario, permisos), {
      limite: limite ? Number(limite) : undefined,
      abiertos: abiertos === 'true',
      desde,
      hasta,
    });
    return casos.map((c) => this.ocultarGrabaciones(c, permisos));
  }

  // Cómo se clasifica un cierre ya no se responde aquí: es catálogo del secad,
  // en GET /api/catalogos/codigos-cierre.

  /**
   * GET /api/casos/tenants-remitibles — directorio liviano de instancias a las
   * que se puede remitir un caso (otra jurisdicción). Va ANTES de :id: si no,
   * Nest la confundiría con el id de un caso.
   */
  @Permisos('casos.remitir_tenant')
  @Get('tenants-remitibles')
  tenantsRemitibles(@Tenant() tenant: string) {
    return this.casos.tenantsRemitibles(tenant);
  }

  /** GET /api/casos/:id */
  @Get(':id')
  async obtener(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    const caso = await this.casos.obtener(tenant, id, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /** GET /api/casos/:id/auditoria — línea de tiempo del caso. */
  @Get(':id/auditoria')
  async auditoria(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.casos.listarAuditoria(tenant, id, await this.actor(usuario, permisos));
  }

  /** POST /api/casos — recepcionar un caso nuevo (creador tomado del JWT). */
  @Permisos('casos.crear')
  @Post()
  crear(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Body() dto: CrearCasoDto) {
    // El origen del caso es SIEMPRE la agencia del funcionario, nunca el cuerpo.
    return this.casos.crear(tenant, dto, usuario?.sub ?? 'desconocido', usuario?.agencia ?? null);
  }

  /**
   * POST /api/casos/:id/tomar — hacerse cargo. Lo llama la interfaz al abrir un
   * caso nuevo: se asume que quien lo abre lo va a gestionar.
   */
  @Permisos('casos.gestionar')
  @Post(':id/tomar')
  async tomar(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    const caso = await this.casos.tomar(tenant, id, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /** POST /api/casos/:id/remitir — enviar el caso a canales de otra agencia. */
  @Permisos('casos.gestionar')
  @Post(':id/remitir')
  async remitir(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: RemitirDto,
  ) {
    const caso = await this.casos.remitir(tenant, id, dto, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /**
   * POST /api/casos/:id/remitir-tenant — remitir el caso a OTRA jurisdicción
   * (otro tenant). Distinto de /remitir (canales del mismo tenant): cruza la
   * frontera de aislamiento del secad, así que exige su propio permiso.
   */
  @Permisos('casos.remitir_tenant')
  @Post(':id/remitir-tenant')
  async remitirTenant(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: RemitirTenantDto,
  ) {
    const caso = await this.casos.remitirATenant(tenant, id, dto, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /** POST /api/casos/:id/notas — agregar una nota a la bitácora. */
  @Permisos('casos.gestionar')
  @Post(':id/notas')
  async agregarNota(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: AgregarNotaDto,
  ) {
    const actor = await this.actor(usuario, permisos);
    return this.casos.agregarNota(tenant, id, dto?.texto, actor.sub, actor);
  }

  /**
   * POST /api/casos/:id/reapertura/solicitar — pedirle a un supervisor que
   * reabra un caso cerrado. No lo reabre: deja la solicitud y su motivo.
   */
  @Permisos('casos.gestionar')
  @Post(':id/reapertura/solicitar')
  async solicitarReapertura(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: SolicitarReaperturaDto,
  ) {
    const caso = await this.casos.solicitarReapertura(tenant, id, dto?.motivo, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /** POST /api/casos/:id/reapertura — reapertura autorizada, con observación. */
  @Permisos('casos.reabrir')
  @Post(':id/reapertura')
  async reabrir(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: ReabrirDto,
  ) {
    const estado: EstadoCaso = dto?.estado ?? 'en_gestion';
    const caso = await this.casos.reabrir(tenant, id, dto?.motivo, estado, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }

  /** PATCH /api/casos/:id/estado — avanzar el ciclo de vida / derivar. */
  @Permisos('casos.gestionar')
  @Patch(':id/estado')
  async cambiarEstado(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
  ) {
    const caso = await this.casos.cambiarEstado(tenant, id, dto, await this.actor(usuario, permisos));
    return this.ocultarGrabaciones(caso, permisos);
  }
}
