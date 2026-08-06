import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { RolesService } from '../roles/roles.service';
import { TenantsService } from '../tenants/tenants.service';

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
  /** Agencia del funcionario (agencias.id); origen de los casos que recepciona. */
  agencia?: string | null;
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
    private readonly tenants: TenantsService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    if (!dto?.usuario?.trim() || !dto?.contrasena) {
      throw new UnauthorizedException('Diligencie usuario y contraseña.');
    }
    const u = await this.usuarios.validar(dto.usuario.trim(), dto.contrasena);
    if (!u) throw new UnauthorizedException('Credenciales inválidas.');
    // La instancia debe estar al día: suspendida o vencida, nadie de ese
    // municipio entra (el superadmin sí, para poder regularizarla).
    if (u.rol !== 'superadmin') {
      const impedimento = await this.tenants.impedimento(u.tenant);
      if (impedimento) throw new UnauthorizedException(impedimento.motivo);
    }
    const permisos = await this.roles.permisosDe(u.tenant ?? null, u.rol);
    return this.emitir(u.username, 'institucional', u.nombre, u.rol, u.tenant ?? null, permisos, u.agenciaId ?? null);
  }

  loginCivil(dto: LoginDto, tenant: string): LoginResult {
    // Demo: cualquier correo con contraseña 'demo' (autoservicio ciudadano).
    if (!dto?.usuario?.trim() || dto?.contrasena !== 'demo') {
      throw new UnauthorizedException('Credenciales de ciudadano inválidas (use contraseña "demo").');
    }
    const usuario = dto.usuario.trim();
    return this.emitir(usuario, 'civil', usuario.split('@')[0], 'ciudadano', tenant, []);
  }

  /**
   * Estado vigente de la sesión. El token conserva lo que era cierto al iniciar
   * sesión; esto devuelve lo que es cierto ahora (permisos del rol, agencia y
   * canales asignados), que es lo que debe gobernar la interfaz.
   */
  async perfil(usuario: JwtPayload) {
    if (usuario?.tipo === 'civil') {
      return { usuario: usuario.sub, nombre: usuario.nombre, rol: usuario.rol, tipo: usuario.tipo,
               tenant: usuario.tenant, permisos: [], agencia: null, canales: [] };
    }
    const u = await this.usuarios.buscarPorUsername(usuario?.sub ?? '');
    if (!u) throw new UnauthorizedException('La cuenta no existe o fue desactivada.');
    const permisos = await this.roles.permisosDe(u.tenant ?? null, u.rol);
    return {
      usuario: u.username, nombre: u.nombre, rol: u.rol, tipo: 'institucional' as const,
      tenant: u.tenant ?? null, permisos, agencia: u.agenciaId ?? null, canales: u.canales ?? [],
    };
  }

  private emitir(
    sub: string,
    tipo: 'institucional' | 'civil',
    nombre: string,
    rol: string,
    tenant: string | null,
    permisos: string[],
    agencia: string | null = null,
  ): LoginResult {
    const payload: JwtPayload = { sub, tipo, nombre, rol, permisos, tenant, agencia };
    return { token: this.jwt.sign(payload), usuario: sub, tipo, nombre, rol, permisos, tenant, agencia };
  }
}
