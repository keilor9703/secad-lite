import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { BitacoraAdminEntity } from './bitacora-admin.entity';
import { EventoCasoEntity } from '../casos/evento.entity';

@Injectable()
export class RetencionService {
  private readonly logger = new Logger(RetencionService.name);

  constructor(
    @InjectRepository(EventoCasoEntity)
    private readonly eventos: Repository<EventoCasoEntity>,
    @InjectRepository(BitacoraAdminEntity)
    private readonly adminBitacora: Repository<BitacoraAdminEntity>,
    private readonly config: ConfigService,
  ) {}

  /** Purga diaria a las 3 AM: borra eventos más viejos que BITACORA_RETENCION_DIAS días. */
  @Cron('0 3 * * *') // Todos los días a las 3 AM
  async purgar(): Promise<void> {
    const dias = Number(this.config.get('BITACORA_RETENCION_DIAS', '0'));
    if (!dias || dias <= 0) return; // Sin variable, no borra nada
    
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    
    this.logger.log(`Purga de bitácora: eliminando registros anteriores a ${corte.toISOString()}`);
    
    await this.eventos.delete({ creadoEn: LessThan(corte) });
    await this.adminBitacora.delete({ creadoEn: LessThan(corte) });
  }
}
