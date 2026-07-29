import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { Rol } from '../usuarios/usuario.entity';

/** Claims que viajan dentro del JWT. */
export interface JwtPayload {
  sub: string;
  /** 'institucional' = usuario del sistema (staff); 'civil' = ciudadano (chat). */
  tipo: 'institucional' | 'civil';
  nombre: string;
  rol: Rol;
  tenant: string | null;
}

/**
 * Autenticación.
 *  - login: usuario del sistema (username único global); el tenant y el rol salen
 *    del registro del usuario. Validado contra la tabla con bcrypt.
 *  - loginCivil: ciudadano, autoservicio liviano para el chat (rol 'ciudadano');
 *    el tenant se toma del header X-Tenant-Id.
 * El `tenant` y el `rol` viajan en el JWT; los endpoints protegidos los toman de
 * ahí, no del header, de modo que no se pueden falsear.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly usuarios: UsuariosService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    if (!dto?.usuario?.trim() || !dto?.contrasena) {
      throw new UnauthorizedException('Diligencie usuario y contraseña.');
    }
    const u = await this.usuarios.validar(dto.usuario.trim(), dto.contrasena);
    if (!u) throw new UnauthorizedException('Credenciales inválidas.');
    return this.emitir(u.username, 'institucional', u.nombre, u.rol, u.tenant ?? null);
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier correo con contraseña 'demo' (autoservicio ciudadano).
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales de ciudadano inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return this.emitir(usuario, 'civil', usuario.split('@')[0], 'ciudadano', tenant);
  }

  private emitir(
    sub: string,
    tipo: 'institucional' | 'civil',
    nombre: string,
    rol: Rol,
    tenant: string | null,
  ): LoginResult {
    const payload: JwtPayload = { sub, tipo, nombre, rol, tenant };
    return { token: this.jwt.sign(payload), usuario: sub, tipo, nombre, rol, tenant };
  }
}
