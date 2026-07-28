import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Tenant } from '../common/tenant.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/institucional/login — login de funcionarios. */
  @Post('institucional/login')
  institucional(@Body() dto: LoginDto, @Tenant() tenant: string) {
    return this.auth.loginInstitucional(dto, tenant);
  }

  /** POST /api/auth/civil/login — login de ciudadanos / otras agencias. */
  @Post('civil/login')
  civil(@Body() dto: LoginDto, @Tenant() tenant: string) {
    return this.auth.loginCivil(dto, tenant);
  }
}
