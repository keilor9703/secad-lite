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
@Injectable()
export class SuscripcionGuard implements CanActivate {
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

    const impedimento = await this.tenants.impedimento(tenant);
    if (impedimento) throw new ForbiddenException(impedimento.motivo);

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
