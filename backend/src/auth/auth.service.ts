import { Injectable, UnauthorizedException } from '@nestjs/common';
import { LoginDto, LoginResult } from './dto/login.dto';

/**
 * Autenticación (mock del esqueleto). Valida credenciales de demo y emite un
 * token. Mantiene SEPARADOS los dos dominios de identidad del requerimiento:
 *  - institucional: funcionarios de la agencia.
 *  - civil: usuarios de otras agencias / ciudadanía.
 *
 * En producción:
 *  - el login institucional integra el 2FA central (@policia/mfa) y el directorio
 *    de la agencia;
 *  - el login civil usa su propio proveedor de identidad (correo + OTP), nunca el
 *    directorio institucional;
 *  - el token es un JWT firmado. Aquí es un token opaco de demostración.
 */
@Injectable()
export class AuthService {
  private issueToken(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
    return `lite.${body}`;
  }

  loginInstitucional(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier usuario no vacío con contraseña 'demo' entra.
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales institucionales inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return {
      token: this.issueToken({ sub: usuario, tipo: 'institucional', tenant }),
      usuario,
      tipo: 'institucional',
      nombre: usuario,
      tenant,
    };
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier correo con contraseña 'demo' entra.
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales de ciudadano inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return {
      token: this.issueToken({ sub: usuario, tipo: 'civil', tenant }),
      usuario,
      tipo: 'civil',
      nombre: usuario.split('@')[0],
      tenant,
    };
  }
}
