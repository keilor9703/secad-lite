import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CambiarContrasenaDto, ConfirmarMfaDto, InscripcionMfaDto, LoginDto, VerificarMfaDto } from './dto/login.dto';
import { MfaService } from './mfa/mfa.service';
import { Public } from './public.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from './auth.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { AuditoriaAdminService } from '../auditoria/auditoria-admin.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly usuarios: UsuariosService,
    private readonly auditoria: AuditoriaAdminService,
    private readonly mfa: MfaService,
  ) {}

  /**
   * POST /api/auth/login — usuario del sistema (el tenant sale del usuario).
   * Con tope de intentos por IP: sin él, la contraseña se puede adivinar por
   * fuerza bruta a la velocidad que dé el servidor.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // ── Doble factor ────────────────────────────────────────────────────────
  // Los tres son públicos porque el usuario todavía NO tiene sesión: lo que
  // acredita quién es, es el token de reto que devolvió el login. Y los tres
  // llevan tope de intentos: un código de seis dígitos se adivina en un millón
  // de pruebas, que sin límite son minutos.

  /**
   * POST /api/auth/mfa/inscripcion — genera el secreto y el QR para un usuario
   * que todavía no tiene segundo factor. No guarda nada: el secreto viaja
   * dentro del token de inscripción hasta que se confirme con un código.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/inscripcion')
  inscripcion(@Body() dto: InscripcionMfaDto) {
    return this.mfa.iniciarInscripcion(dto?.reto ?? '');
  }

  /**
   * POST /api/auth/mfa/confirmar — el usuario teclea el primer código. Si es
   * correcto, se guarda el secreto y queda autenticado.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/confirmar')
  async confirmar(@Body() dto: ConfirmarMfaDto) {
    const usuarioId = await this.mfa.confirmarInscripcion(dto?.inscripcion ?? '', dto?.codigo ?? '');
    return this.auth.sesionDe(usuarioId);
  }

  /** POST /api/auth/mfa/verificar — usuario ya enrolado que presenta su código. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/verificar')
  async verificar(@Body() dto: VerificarMfaDto) {
    const usuarioId = await this.mfa.verificar(dto?.reto ?? '', dto?.codigo ?? '');
    return this.auth.sesionDe(usuarioId);
  }

  /**
   * GET /api/auth/perfil — quién soy AHORA: rol, permisos, agencia y canales
   * tal como están en la base. La interfaz lo consulta al arrancar porque los
   * datos del token quedaron congelados al iniciar sesión.
   */
  @Get('perfil')
  perfil(@Usuario() usuario: JwtPayload) {
    return this.auth.perfil(usuario);
  }

  /**
   * POST /api/auth/cambiar-contrasena — autoservicio del funcionario: cambia
   * SU contraseña demostrando la actual. Con tope de intentos: la contraseña
   * actual aquí es tan adivinable por fuerza bruta como en el login.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('cambiar-contrasena')
  async cambiarContrasena(@Usuario() usuario: JwtPayload, @Body() dto: CambiarContrasenaDto) {
    if (usuario?.tipo !== 'institucional') {
      throw new ForbiddenException('Solo las cuentas institucionales tienen contraseña propia.');
    }
    const r = await this.usuarios.cambiarContrasenaPropia(usuario.sub, usuario.tenant ?? null, dto.actual, dto.nueva);
    await this.auditoria.registrar(usuario.tenant ?? 'plataforma', usuario.sub, 'contrasena.propia', 'Cambió su propia contraseña.');
    return r;
  }
}
