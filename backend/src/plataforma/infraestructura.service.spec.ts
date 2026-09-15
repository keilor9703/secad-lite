import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InfraestructuraService } from './infraestructura.service';

/**
 * Lo que se protege aquí es la propiedad central de una pantalla de
 * monitoreo: que siga informando aunque una de sus sondas no pueda medir. Un
 * monitor que se cae entero porque el proveedor esconde `pg_stat_activity` no
 * sirve justo el día en que hay que mirarlo.
 */
describe('InfraestructuraService', () => {
  const config = (vals: Record<string, string> = {}) =>
    ({ get: (k: string, def?: string) => vals[k] ?? def }) as unknown as ConfigService;

  const dataSource = (query: jest.Mock) => ({ query }) as unknown as DataSource;

  describe('salud', () => {
    it('informa la base viva aunque tamaño, conexiones y versión no se dejen consultar', async () => {
      // Primer SELECT 1 pasa; las sondas de detalle fallan, como tras un pooler.
      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('SELECT 1')) return Promise.resolve([{ '?column?': 1 }]);
        return Promise.reject(new Error('permission denied'));
      });
      const svc = new InfraestructuraService(dataSource(query), config());

      const salud = await svc.salud();

      expect(salud.base.disponible).toBe(true);
      if (salud.base.disponible) {
        expect(salud.base.valor.tamanoBytes.disponible).toBe(false);
        expect(salud.base.valor.conexiones.disponible).toBe(false);
        expect(salud.base.valor.version.disponible).toBe(false);
        expect(typeof salud.base.valor.latenciaMs).toBe('number');
      }
      expect(salud.api.ok).toBe(true);
    });

    it('marca la base como no disponible cuando ni el ping responde', async () => {
      const query = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = new InfraestructuraService(dataSource(query), config());

      const salud = await svc.salud();

      expect(salud.base.disponible).toBe(false);
      if (!salud.base.disponible) expect(salud.base.motivo).toContain('ECONNREFUSED');
    });

    it('distingue "Redis no configurado" de "Redis caído"', async () => {
      const query = jest.fn().mockResolvedValue([{ v: 1 }]);
      const svc = new InfraestructuraService(dataSource(query), config());

      const salud = await svc.salud();

      // Sin REDIS_URL no es una falla: el sistema opera en una sola instancia.
      expect(salud.redis.disponible).toBe(false);
      if (!salud.redis.disponible) expect(salud.redis.motivo).toContain('No configurado');
    });
  });

  describe('infraestructura', () => {
    it('cae a las medidas del sistema cuando no hay archivos de cgroup', async () => {
      const query = jest.fn().mockResolvedValue([{ v: 1 }]);
      const svc = new InfraestructuraService(dataSource(query), config());

      const infra = await svc.infraestructura();

      // En el entorno de pruebas (macOS/Linux sin contenedor) no hay cgroup:
      // la memoria debe medirse igual, declarando que viene del sistema.
      expect(infra.memoria.disponible).toBe(true);
      if (infra.memoria.disponible) {
        expect(infra.memoria.valor.fuente).toBe('sistema');
        expect(infra.memoria.valor.totalBytes).toBeGreaterThan(0);
        expect(infra.memoria.valor.porcentaje).toBeGreaterThanOrEqual(0);
        expect(infra.memoria.valor.porcentaje).toBeLessThanOrEqual(100);
      }
      expect(infra.contenedor).toBe(false);
      expect(infra.proceso.uptimeSegundos).toBeGreaterThanOrEqual(0);
      expect(infra.proceso.rssBytes).toBeGreaterThan(0);
    });
  });
});
