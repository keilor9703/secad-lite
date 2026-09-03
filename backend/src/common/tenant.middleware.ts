import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

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
  constructor(private dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // Sin valor por defecto: una petición pública sin header queda SIN tenant
    // y el decorador la rechaza con un mensaje claro. El 'demo' silencioso de
    // antes era una trampa: cualquier integración futura mal configurada
    // habría caído calladamente en la instancia de demostración.
    const header = req.header('X-Tenant-Id');
    const tenant = (header && header.trim()) || undefined;
    req.tenantId = tenant;

    if (tenant) {
      try {
        // LIMITACIÓN: typeorm usa pool de conexiones, por lo que RLS usando 'app.tenant'
        // puede no persistir para siguientes queries a menos que caigan en la misma conexión.
        await this.dataSource.query(`SELECT set_tenant($1)`, [tenant]);
      } catch {
        // Ignorar si RLS no está habilitado
      }
    }

    next();
  }
}
