import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { PlantaSaludService } from './planta-salud.service';

/**
 * Clave del advisory lock.
 *
 * Las tres réplicas corren el mismo `@Cron`: sin esto, las tres revisarían las
 * mismas plantas a la vez y las tres mandarían el mismo correo. Un aviso
 * triplicado se deja de leer igual de rápido que un aviso cada cinco minutos.
 */
const LOCK_SALUD_PLANTA = 1822000000;

/**
 * Dispara la revisión de las plantas cada cinco minutos.
 *
 * ¿Por qué cinco y no uno? Porque lo que se vigila son caídas, no microcortes:
 * una troncal que se cae vuelve en minutos o no vuelve sola, y en ninguno de
 * los dos casos cambia nada por enterarse cuatro minutos antes. Un minuto, en
 * cambio, multiplica por cinco las conexiones contra cada planta para no
 * responder ninguna pregunta nueva.
 *
 * Las tres réplicas ejecutan este `@Cron`; el que decide que solo una trabaje
 * es el advisory lock de aquí abajo.
 */
@Injectable()
export class PlantaSaludBarridoService {
  private readonly logger = new Logger(PlantaSaludBarridoService.name);

  constructor(
    private readonly salud: PlantaSaludService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async barrer(): Promise<void> {
    try {
      await this.conCandado(() => this.salud.revisarTodas());
    } catch (e) {
      // Que falle la revisión no puede tumbar el proceso: es vigilancia, y la
      // pasada que no se hizo se vuelve a intentar en cinco minutos.
      this.logger.error(`Revisión de plantas falló: ${(e as Error)?.message}`);
    }
  }

  /**
   * Corre el trabajo solo si esta réplica se queda con el candado.
   *
   * El lock tiene que vivir en UNA conexión: `pg_advisory_lock` es por sesión,
   * y con el pool cada consulta suelta puede caer en otra. Con el runner
   * propio, candado y trabajo comparten sesión y el unlock libera lo que tomó.
   */
  private async conCandado(trabajo: () => Promise<number>): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ tomado }] = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS tomado',
        [LOCK_SALUD_PLANTA],
      )) as Array<{ tomado: boolean }>;
      if (!tomado) return;

      try {
        const n = await trabajo();
        if (n) this.logger.debug(`${n} planta(s) revisada(s).`);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [
          LOCK_SALUD_PLANTA,
        ]);
      }
    } finally {
      await runner.release();
    }
  }
}
