import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CambiarContrasenaDto, LoginDto } from './dto/login.dto';
import { Tenant } from '../common/tenant.decorator';
import { Public } from './public.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from './auth.service';
import { UsuariosService } from '../usuarios/usuarios.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly usuarios: UsuariosService,
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
  cambiarContrasena(@Usuario() usuario: JwtPayload, @Body() dto: CambiarContrasenaDto) {
    if (usuario?.tipo !== 'institucional') {
      throw new ForbiddenException('Solo las cuentas institucionales tienen contraseña propia.');
    }
    return this.usuarios.cambiarContrasenaPropia(usuario.sub, usuario.tenant ?? null, dto.actual, dto.nueva);
  }

  /** POST /api/auth/civil/login — ciudadano (chat); el tenant viene del header. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('civil/login')
  civil(@Body() dto: LoginDto, @Tenant() tenant: string) {
    return this.auth.loginCivil(dto, tenant);
  }
}
