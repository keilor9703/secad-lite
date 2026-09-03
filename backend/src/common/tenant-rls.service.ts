import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Fija `app.tenant` (RLS, ver migración HabilitarRLS) para las seis tablas
 * protegidas: casos, casos_eventos, asignaciones, recursos, llamadas,
 * casos_mensajes.
 *
 * `SET LOCAL` solo vive DENTRO de la transacción donde se ejecuta — y con el
 * pool de conexiones de TypeORM, cada llamada suelta a un repositorio
 * inyectado (`this.algoRepo.find(...)`) puede caer en una conexión distinta
 * de la que lo fijó, o simplemente en su propia sentencia autocommit (que ya
 * es su propia transacción, y termina apenas se ejecuta). Por eso NO alcanza
 * con hacer `SELECT set_tenant($1)` antes y ya: hay que fijarlo y tocar la
 * tabla protegida DENTRO de la MISMA transacción, con el `manager` que este
 * método entrega — no con el repositorio inyectado del constructor.
 */
@Injectable()
export class TenantRlsService {
  constructor(private readonly dataSource: DataSource) {}

  async conTenant<T>(tenant: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT set_tenant($1)', [tenant]);
      return fn(manager);
    });
  }
}
