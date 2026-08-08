import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { INTEGRACION_KEY } from './integracion.decorator';
import { JwtPayload } from '../auth/auth.service';
import { TenantsService } from './tenants.service';

/**
 * Puerta del servicio. FALCON CAD se presta por suscripción, así que antes de
 * atender cualquier petición se comprueba que la instancia esté al día: activa,
 * sin suspender y sin vencer. Y si el módulo pertenece a una integración
 * contratable, que el tenant la tenga habilitada.
 *
 * El superadmin queda fuera: es el dueño de la plataforma y necesita entrar
 * justamente cuando un tenant está bloqueado.
 */
/** Cuánto se reutiliza el veredicto antes de volver a consultar la base. */
const VIGENCIA_CACHE_MS = 15_000;

@Injectable()
export class SuscripcionGuard implements CanActivate {
  /** El estado de una suscripción no cambia por segundo: se memoriza unos
   *  segundos por tenant, igual que hace PermisosGuard con los permisos —
   *  antes esto costaba un SELECT del tenant en CADA petición autenticada. */
  private readonly cache = new Map<string, { impedimento: { motivo: string } | null; expira: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;
    if (!user || user.rol === 'superadmin') return true;

    const tenant = user.tenant;
    if (!tenant) return true;

    let guardado = this.cache.get(tenant);
    if (!guardado || guardado.expira <= Date.now()) {
      guardado = { impedimento: await this.tenants.impedimento(tenant), expira: Date.now() + VIGENCIA_CACHE_MS };
      this.cache.set(tenant, guardado);
    }
    if (guardado.impedimento) throw new ForbiddenException(guardado.impedimento.motivo);

    const integracion = this.reflector.getAllAndOverride<string>(INTEGRACION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (integracion && !(await this.tenants.tieneIntegracion(tenant, integracion))) {
      throw new ForbiddenException(`El módulo de ${integracion} no está habilitado para esta instancia.`);
    }
    return true;
  }
}
