import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Multitenancy (stub). En el SaaS real, cada municipio es un tenant. Aquí se
 * resuelve el tenant desde el header `X-Tenant-Id` (lo envía el frontend) y se
 * adjunta al request, para que @Tenant() lo use en rutas públicas (login
 * civil). Fijar `app.tenant` para RLS NO se hace aquí: `SET LOCAL` solo vive
 * dentro de UNA transacción, y esta petición todavía no abrió la suya — eso
 * lo hace TenantRlsService.conTenant() justo antes de tocar una tabla
 * protegida, con el EntityManager de esa misma transacción.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    // Sin valor por defecto: una petición pública sin header queda SIN tenant
    // y el decorador la rechaza con un mensaje claro. El 'demo' silencioso de
    // antes era una trampa: cualquier integración futura mal configurada
    // habría caído calladamente en la instancia de demostración.
    const header = req.header('X-Tenant-Id');
    req.tenantId = (header && header.trim()) || undefined;
    next();
  }
}
