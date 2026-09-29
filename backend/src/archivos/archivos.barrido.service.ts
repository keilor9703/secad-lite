import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ArchivosService } from './archivos.service';

/**
 * Cierra las subidas que quedaron a medias.
 *
 * Una grabación se abre al empezar a grabar y se cierra al terminar. Si el
 * puesto del despachador muere en medio —se va la luz, se cierra el navegador,
 * se cae la red— nadie la cierra, y quedaría EN_CURSO para siempre. Este
 * barrido la marca como fallida, sin borrar nada: lo que alcanzó a subirse
 * sigue ahí, porque puede ser justamente lo que importa.
 */
@Injectable()
export class ArchivosBarridoService {
  private readonly logger = new Logger(ArchivosBarridoService.name);

  constructor(private readonly archivos: ArchivosService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async barrer(): Promise<void> {
    try {
      await this.archivos.barrerAbandonados();
    } catch (e) {
      // Que falle el barrido no puede tumbar el proceso: es mantenimiento.
      this.logger.error(`Barrido de subidas abandonadas falló: ${(e as Error)?.message}`);
    }
  }
}
