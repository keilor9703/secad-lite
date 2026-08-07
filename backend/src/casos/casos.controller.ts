import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Actor, CasosService } from './casos.service';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { AgregarNotaDto } from './dto/agregar-nota.dto';
import { RemitirDto } from './dto/remitir.dto';
import { ReabrirDto, SolicitarReaperturaDto } from './dto/reabrir.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { Tenant } from '../common/tenant.decorator';
import { Usuario } from '../common/usuario.decorator';
import { PermisosVigentes } from '../common/permisos-vigentes.decorator';
import { JwtPayload } from '../auth/auth.service';
import { Permisos } from '../auth/permisos.decorator';
import { EstadoCaso } from './caso.model';

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
    const yo = await this.usuarios.buscarPorUsername(usuario?.sub ?? '');
    return {
      sub: usuario?.sub ?? 'desconocido',
      rol: usuario?.rol ?? 'operador',
      permisos: permisos.includes('*') ? [] : permisos,
      canales: yo?.canales ?? [],
    };
  }

  /**
   * GET /api/casos — bandeja del secad.
   * Lo que devuelve depende del alcance del funcionario: con casos.ver_todos,
   * todo; sin él, solo lo de sus canales y lo que él recepcionó.
   */
  @Get()
  async listar(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @PermisosVigentes() permisos: string[]) {
    return this.casos.listar(tenant, await this.actor(usuario, permisos));
  }

  // Cómo se clasifica un cierre ya no se responde aquí: es catálogo del secad,
  // en GET /api/catalogos/codigos-cierre.

  /** GET /api/casos/:id */
  @Get(':id')
  async obtener(
    @Tenant() tenant: string,
    @Usuario() usuario: JwtPayload,
    @PermisosVigentes() permisos: string[],
    @Param('id') id: string,
  ) {
    return this.casos.obtener(tenant, id, await this.actor(usuario, permisos));
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
    return this.casos.tomar(tenant, id, await this.actor(usuario, permisos));
  }

  /** POST /api/casos/:id/remitir — enviar el caso a canales de otra agencia. */
  @Permisos('casos.gestionar')
  @Post(':id/remitir')
  remitir(@Tenant() tenant: string, @Usuario() usuario: JwtPayload, @Param('id') id: string, @Body() dto: RemitirDto) {
    return this.casos.remitir(tenant, id, dto, usuario?.sub ?? 'desconocido');
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
    return this.casos.solicitarReapertura(tenant, id, dto?.motivo, await this.actor(usuario, permisos));
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
    return this.casos.reabrir(tenant, id, dto?.motivo, estado, await this.actor(usuario, permisos));
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
    return this.casos.cambiarEstado(tenant, id, dto, await this.actor(usuario, permisos));
  }
}
