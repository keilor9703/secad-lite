import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';

/** Claims que viajan dentro del JWT. */
export interface JwtPayload {
  sub: string;
  tipo: 'institucional' | 'civil';
  nombre: string;
  tenant: string;
}

/**
 * Autenticación. Valida credenciales (demo) y emite un JWT firmado. Mantiene
 * SEPARADOS los dos dominios de identidad:
 *  - institucional: funcionarios de la agencia (en prod integra @policia/mfa).
 *  - civil: ciudadanía / otras agencias (proveedor de identidad propio).
 * El `tenant` viaja en el token; los endpoints protegidos lo toman de ahí (no
 * del header), de modo que no se puede falsear con X-Tenant-Id.
 */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  loginInstitucional(dto: LoginDto, tenant: string): LoginResult {
    this.validar(dto, 'Credenciales institucionales inválidas');
    return this.emitir(dto.usuario.trim(), 'institucional', dto.usuario.trim(), tenant);
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    this.validar(dto, 'Credenciales de ciudadano inválidas');
    const usuario = dto.usuario.trim();
    return this.emitir(usuario, 'civil', usuario.split('@')[0], tenant);
  }

  private validar(dto: LoginDto, msg: string): void {
    // Demo: cualquier usuario no vacío con contraseña 'demo'.
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException(`${msg} (use contraseña "demo").`);
    }
  }

  private emitir(sub: string, tipo: 'institucional' | 'civil', nombre: string, tenant: string): LoginResult {
    const payload: JwtPayload = { sub, tipo, nombre, tenant };
    return { token: this.jwt.sign(payload), usuario: sub, tipo, nombre, tenant };
  }
}
