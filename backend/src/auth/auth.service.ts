import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginDto, LoginResult } from './dto/login.dto';
import { UsuariosService } from '../usuarios/usuarios.service';
import { RolesService } from '../roles/roles.service';
import { TenantsService } from '../tenants/tenants.service';

/** Claims que viajan dentro del JWT. */
export interface JwtPayload {
  sub: string;
  /** Usuario del sistema (staff); único tipo de sesión que existe. */
  tipo: 'institucional';
  nombre: string;
  /** Código del rol (dinámico por tenant); 'superadmin' es reservado. */
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
    const { integraciones, logoDataUrl, municipioCodigo } = await this.datosTenant(u.tenant ?? null);
    return this.emitir(
      u.username, u.nombre, u.rol, u.tenant ?? null, permisos, u.agenciaId ?? null,
      integraciones, logoDataUrl, municipioCodigo,
    );
  }

  /**
   * Estado vigente de la sesión. El token conserva lo que era cierto al iniciar
   * sesión; esto devuelve lo que es cierto ahora (permisos del rol, agencia y
   * canales asignados), que es lo que debe gobernar la interfaz.
   */
  async perfil(usuario: JwtPayload) {
    const u = await this.usuarios.buscarPorUsernameYTenant(usuario?.sub ?? '', usuario?.tenant ?? null);
    if (!u) throw new UnauthorizedException('La cuenta no existe o fue desactivada.');
    const permisos = await this.roles.permisosDe(u.tenant ?? null, u.rol);
    const { integraciones, logoDataUrl, municipioCodigo } = await this.datosTenant(u.tenant ?? null);
    return {
      usuario: u.username, nombre: u.nombre, rol: u.rol, tipo: 'institucional' as const,
      tenant: u.tenant ?? null, permisos, agencia: u.agenciaId ?? null, canales: u.canales ?? [],
      integraciones, logoDataUrl, municipioCodigo,
    };
  }

  /**
   * Integraciones contratadas y logo del tenant, para que la interfaz sepa qué
   * módulos pedir sin tener que intentarlos y toparse con el rechazo del
   * guard, y pueda mostrar la identidad visual del municipio. El superadmin no
   * pertenece a ningún tenant fijo (trabaja sobre el que elija en la barra
   * superior), así que aquí no aplica — la UI resuelve ese caso aparte, con la
   * lista de tenants que ya tiene cargada.
   *
   * `integraciones: null` (no `[]`) cuando el tenant no tiene la lista
   * configurada: son las instancias creadas antes de que existieran los
   * módulos contratables, y no hay restricción para ellas — igual que en
   * `TenantsService.tieneIntegracion`. Si se devolviera `[]` en su lugar, la
   * UI lo interpretaría como "ninguna integración contratada" y ocultaría
   * paneles (PBX, CTI, WhatsApp…) que sí deben verse.
   */
  private async datosTenant(
    tenant: string | null,
  ): Promise<{ integraciones: string[] | null; logoDataUrl: string | null; municipioCodigo: string | null }> {
    if (!tenant) return { integraciones: null, logoDataUrl: null, municipioCodigo: null };
    const t = await this.tenants.porCodigo(tenant);
    return { integraciones: t?.integraciones ?? null, logoDataUrl: t?.logoDataUrl ?? null, municipioCodigo: t?.codigoDane ?? null };
  }

  private emitir(
    sub: string,
    nombre: string,
    rol: string,
    tenant: string | null,
    permisos: string[],
    agencia: string | null = null,
    integraciones: string[] | null = null,
    logoDataUrl: string | null = null,
    municipioCodigo: string | null = null,
  ): LoginResult {
    const tipo = 'institucional' as const;
    const payload: JwtPayload = { sub, tipo, nombre, rol, permisos, tenant, agencia };
    return {
      token: this.jwt.sign(payload), usuario: sub, tipo, nombre, rol, permisos, tenant, agencia,
      integraciones, logoDataUrl, municipioCodigo,
    };
  }
}
