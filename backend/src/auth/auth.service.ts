import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { Rol } from '../usuarios/usuario.entity';

/** Claims que viajan dentro del JWT. */
export interface JwtPayload {
  sub: string;
  tipo: 'institucional' | 'civil';
  nombre: string;
  rol: Rol;
  tenant: string;
}

/**
 * Autenticación. Dos dominios de identidad separados:
 *  - institucional: funcionarios validados contra la tabla `usuarios` (bcrypt),
 *    con rol (operador/supervisor/admin). En prod integra @policia/mfa.
 *  - civil: ciudadanía / otras agencias, autoservicio liviano (rol 'ciudadano').
 * El `tenant` y el `rol` viajan en el JWT; los endpoints protegidos los toman de
 * ahí, no del header, de modo que no se pueden falsear.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly usuarios: UsuariosService,
  ) {}

  async loginInstitucional(dto: LoginDto, tenant: string): Promise<LoginResult> {
    if (!dto?.usuario?.trim() || !dto?.contrasena) {
      throw new UnauthorizedException('Diligencie usuario y contraseña.');
    }
    const u = await this.usuarios.validar(tenant, dto.usuario.trim(), dto.contrasena);
    if (!u) throw new UnauthorizedException('Credenciales institucionales inválidas.');
    return this.emitir(u.username, 'institucional', u.nombre, u.rol, tenant);
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier correo con contraseña 'demo' (autoservicio ciudadano).
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales de ciudadano inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return this.emitir(usuario, 'civil', usuario.split('@')[0], 'ciudadano', tenant);
  }

  private emitir(sub: string, tipo: 'institucional' | 'civil', nombre: string, rol: Rol, tenant: string): LoginResult {
    const payload: JwtPayload = { sub, tipo, nombre, rol, tenant };
    return { token: this.jwt.sign(payload), usuario: sub, tipo, nombre, rol, tenant };
  }
}
