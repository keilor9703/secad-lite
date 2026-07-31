import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { RolesService } from '../roles/roles.service';

/** Claims que viajan dentro del JWT. */
export interface JwtPayload {
  sub: string;
  /** 'institucional' = usuario del sistema (staff); 'civil' = ciudadano (chat). */
  tipo: 'institucional' | 'civil';
  nombre: string;
  /** Código del rol (dinámico por tenant); 'superadmin'/'ciudadano' son reservados. */
  rol: string;
  /** Permisos efectivos del rol al momento del login (RBAC dinámico). */
  permisos: string[];
  tenant: string | null;
}

/**
 * Autenticación. El `tenant`, el `rol` y sus `permisos` viajan en el JWT; los
 * endpoints protegidos los toman de ahí, no del header, de modo que no se
 * pueden falsear.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly usuarios: UsuariosService,
    private readonly roles: RolesService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    if (!dto?.usuario?.trim() || !dto?.contrasena) {
      throw new UnauthorizedException('Diligencie usuario y contraseña.');
    }
    const u = await this.usuarios.validar(dto.usuario.trim(), dto.contrasena);
    if (!u) throw new UnauthorizedException('Credenciales inválidas.');
    const permisos = await this.roles.permisosDe(u.tenant ?? null, u.rol);
    return this.emitir(u.username, 'institucional', u.nombre, u.rol, u.tenant ?? null, permisos);
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier correo con contraseña 'demo' (autoservicio ciudadano).
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales de ciudadano inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return this.emitir(usuario, 'civil', usuario.split('@')[0], 'ciudadano', tenant, []);
  }

  private emitir(
    sub: string,
    tipo: 'institucional' | 'civil',
    nombre: string,
    rol: string,
    tenant: string | null,
    permisos: string[],
  ): LoginResult {
    const payload: JwtPayload = { sub, tipo, nombre, rol, permisos, tenant };
    return { token: this.jwt.sign(payload), usuario: sub, tipo, nombre, rol, permisos, tenant };
  }
}
