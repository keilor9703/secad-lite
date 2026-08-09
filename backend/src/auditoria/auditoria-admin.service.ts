import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BitacoraAdminEntity } from './bitacora-admin.entity';

/**
 * Registro y consulta de la bitácora administrativa. `registrar` es
 * deliberadamente a prueba de fallos: un problema al escribir la bitácora
 * jamás debe tumbar la acción administrativa que la origina.
 */
@Injectable()
export class AuditoriaAdminService {
  private readonly log = new Logger(AuditoriaAdminService.name);

  constructor(
    @InjectRepository(BitacoraAdminEntity)
    private readonly repo: Repository<BitacoraAdminEntity>,
  ) {}

  async registrar(tenant: string, autor: string, accion: string, detalle: string): Promise<void> {
    try {
      await this.repo.save(this.repo.create({ tenant, autor, accion, detalle }));
    } catch (e) {
      this.log.warn(`No se pudo registrar en la bitácora (${accion}): ${(e as Error).message}`);
    }
  }

  /** Las últimas entradas de la instancia, recientes primero. */
  listar(tenant: string, limite = 100): Promise<BitacoraAdminEntity[]> {
    return this.repo.find({
      where: { tenant },
      order: { creadoEn: 'DESC' },
      take: Math.min(Math.max(limite, 1), 300),
    });
  }
}
