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

  /**
   * Recorre varios tenants en UNA sola transacción, refijando `app.tenant`
   * antes de cada uno. Es la forma de agregar datos de las tablas protegidas a
   * través de toda la plataforma (ver el módulo Plataforma) sin abrir un hueco
   * en el aislamiento: no hay comodín ni llave maestra, simplemente se visita
   * cada instancia con su propio contexto y se suma por fuera.
   *
   * Llamar `conTenant` en un bucle daría el mismo resultado, pero abriría una
   * transacción por instancia; aquí se paga el arranque una sola vez.
   *
   * El coste es lineal en número de instancias: quien lo use debe cachear el
   * resultado. Si algún día fueran cientos, la salida sería una función SQL
   * `SECURITY DEFINER` que devuelva solo agregados —nunca filas—, pero eso
   * exige un rol con BYPASSRLS que no todos los proveedores conceden.
   */
  async porCadaTenant<T>(
    tenants: string[],
    fn: (manager: EntityManager, tenant: string) => Promise<T>,
  ): Promise<Array<{ tenant: string; valor: T }>> {
    if (!tenants.length) return [];
    return this.dataSource.transaction(async (manager) => {
      const salida: Array<{ tenant: string; valor: T }> = [];
      for (const tenant of tenants) {
        await manager.query('SELECT set_tenant($1)', [tenant]);
        salida.push({ tenant, valor: await fn(manager, tenant) });
      }
      return salida;
    });
  }
}
