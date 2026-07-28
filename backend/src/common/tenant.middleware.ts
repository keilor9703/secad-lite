import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Multitenancy (stub). En el SaaS real, cada municipio es un tenant. Aquí se
 * resuelve el tenant desde el header `X-Tenant-Id` (lo envía el frontend) y se
 * adjunta al request. En producción, con el modelo pooled, este id filtra todas
 * las consultas (row-level security o esquema por tenant).
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
    const header = req.header('X-Tenant-Id');
    req.tenantId = (header && header.trim()) || 'demo';
    next();
  }
}
