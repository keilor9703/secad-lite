import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TenantsService } from '../tenants/tenants.service';
import { TenantEntity } from '../tenants/tenant.entity';

/** Lo que este guard deja disponible en la petición para el resto del pipeline. */
export type PeticionPbx = Request & { pbxTenant?: TenantEntity };

/**
 * Autentica el webhook de PBX por la API key del tenant (header `x-api-key`)
 * — ANTES de que el `ValidationPipe` toque el body. En NestJS los Guards
 * corren antes que los Pipes a propósito: no tiene sentido gastar en validar
 * la forma de una petición que ni siquiera demostró tener derecho a estar
 * ahí, y sin esto cualquiera —sin ninguna key— podía aprender la forma
 * exacta del contrato (qué campos existen, cuáles son obligatorios) con solo
 * mandar bodies sueltos, sin haberse autenticado.
 *
 * Deja el tenant ya resuelto en `req.pbxTenant`, para que el controlador (y
 * de ahí el filtro/interceptor de registro del webhook) no tengan que volver
 * a buscarlo.
 */
@Injectable()
export class PbxApiKeyGuard implements CanActivate {
  constructor(private readonly tenants: TenantsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PeticionPbx>();
    const cabecera = req.headers['x-api-key'];
    const apiKey = Array.isArray(cabecera) ? cabecera[0] : cabecera;
    const tenant = apiKey ? await this.tenants.porApiKey(apiKey) : null;
    if (!tenant) throw new UnauthorizedException('API key inválida.');

    // Bloqueado, suscripción suspendida/vencida, o sin la integración pbx
    // contratada: nada de esto lo revisa el guard global (SuscripcionGuard),
    // que solo mira `req.user` — esta ruta es pública, sin sesión.
    this.tenants.asegurarVigente(tenant, 'pbx');

    req.pbxTenant = tenant;
    return true;
  }
}
