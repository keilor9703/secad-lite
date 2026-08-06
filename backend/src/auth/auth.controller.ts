import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Tenant } from '../common/tenant.decorator';
import { Public } from './public.decorator';
import { Usuario } from '../common/usuario.decorator';
import { JwtPayload } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/login — usuario del sistema (el tenant sale del usuario). */
  @Public()
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

  /** POST /api/auth/civil/login — ciudadano (chat); el tenant viene del header. */
  @Public()
  @Post('civil/login')
  civil(@Body() dto: LoginDto, @Tenant() tenant: string) {
    return this.auth.loginCivil(dto, tenant);
  }
}
