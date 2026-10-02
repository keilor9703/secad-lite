import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ArchivadoService } from './archivado.service';

/**
 * Dispara el archivado de grabaciones una vez por noche.
 *
 * A las 3:19 y no a las 3:00: a las en punto corren el respaldo y media
 * infraestructura, y esto compite por el mismo disco y la misma red.
 *
 * Las tres réplicas ejecutan este @Cron; el que decide que solo una trabaje es
 * el advisory lock de ArchivadoService, no este archivo.
 */
@Injectable()
export class ArchivadoBarridoService {
  private readonly logger = new Logger(ArchivadoBarridoService.name);

  constructor(private readonly archivado: ArchivadoService) {}

  @Cron('19 3 * * *')
  async barrer(): Promise<void> {
    try {
      await this.archivado.archivarVencidos();
    } catch (e) {
      // Que falle el archivado no puede tumbar el proceso: es mantenimiento, y
      // lo que no se archivó hoy sigue en la base para mañana.
      this.logger.error(`Archivado de grabaciones falló: ${(e as Error)?.message}`);
    }
  }
}
