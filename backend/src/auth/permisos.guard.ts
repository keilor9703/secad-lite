import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISOS_KEY } from './permisos.decorator';
import { JwtPayload } from './auth.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { RolesService } from '../roles/roles.service';

/** Cuánto se reutiliza la resolución de permisos antes de volver a consultar. */
const VIGENCIA_CACHE_MS = 10_000;

/**
 * Autorización por permisos (RBAC dinámico).
 *
 * Los permisos NO se leen del token: se resuelven contra la base en cada
 * petición, a partir del rol que el usuario tenga en ese momento. Si se leyeran
 * del JWT, quitarle un permiso a un rol no surtiría efecto hasta que cada
 * funcionario volviera a iniciar sesión — y mientras tanto seguiría haciendo lo
 * que ya no le corresponde. De paso, una cuenta desactivada deja de pasar
 * aunque su token siga siendo válido.
 *
 * Se memoriza el resultado unos segundos para no consultar dos veces por
 * pantalla; es una ventana lo bastante corta para que un cambio de permisos se
 * sienta inmediato.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  private readonly cache = new Map<string, { permisos: string[]; expira: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly usuarios: UsuariosService,
    private readonly roles: RolesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requeridos = this.reflector.getAllAndOverride<string[]>(PERMISOS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requeridos || requeridos.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user) throw new ForbiddenException('No autenticado.');
    if (user.rol === 'superadmin') return true;

    const permisos = await this.vigentes(user);
    // Se dejan en el request para que los servicios decidan sobre lo vigente
    // (por ejemplo, quién puede cerrar o ver toda la bandeja).
    req.permisosVigentes = permisos;

    if (requeridos.every((p) => permisos.includes(p))) return true;
    throw new ForbiddenException('No tiene permiso para esta acción.');
  }

  private async vigentes(user: JwtPayload): Promise<string[]> {
    // El ciudadano no está en el directorio de funcionarios: sus permisos son
    // los del token (vacíos salvo lo propio del chat).
    if (user.tipo === 'civil') return user.permisos ?? [];

    const clave = `${user.tenant ?? '-'}|${user.sub}`;
    const guardado = this.cache.get(clave);
    if (guardado && guardado.expira > Date.now()) return guardado.permisos;

    // buscarPorUsername solo devuelve cuentas activas.
    const u = await this.usuarios.buscarPorUsername(user.sub);
    if (!u) throw new ForbiddenException('La cuenta no existe o fue desactivada.');
    const permisos = await this.roles.permisosDe(u.tenant ?? null, u.rol);
    this.cache.set(clave, { permisos, expira: Date.now() + VIGENCIA_CACHE_MS });
    return permisos;
  }
}
