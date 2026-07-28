import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasoEntity } from './caso.entity';
import { CANALES, ESTADOS } from './caso.model';
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';

/**
 * Casos persistidos en PostgreSQL. Todo consulta/escribe SIEMPRE acotado por
 * `tenant` (modelo pooled): ningún municipio puede leer/tocar datos de otro.
 */
@Injectable()
export class CasosService implements OnModuleInit {
  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  listar(tenant: string): Promise<CasoEntity[]> {
    return this.repo.find({ where: { tenant }, order: { creadoEn: 'DESC' } });
  }

  async obtener(tenant: string, id: string): Promise<CasoEntity> {
    const caso = await this.repo.findOne({ where: { tenant, id } });
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    return caso;
  }

  async crear(tenant: string, dto: CrearCasoDto, usuario: string): Promise<CasoEntity> {
    if (!dto?.titulo?.trim()) throw new BadRequestException('El título es obligatorio.');
    if (!dto?.ciudadano?.trim()) throw new BadRequestException('El ciudadano es obligatorio.');
    if (!CANALES.includes(dto.canal)) throw new BadRequestException('Canal inválido.');

    const caso = this.repo.create({
      tenant,
      canal: dto.canal,
      titulo: dto.titulo.trim(),
      descripcion: dto.descripcion?.trim() ?? '',
      ciudadano: dto.ciudadano.trim(),
      telefono: dto.telefono?.trim() || null,
      agencia: dto.agencia?.trim() || 'Central',
      estado: 'nuevo',
      creadoPor: usuario,
    });
    return this.repo.save(caso);
  }

  async cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id);
    if (!ESTADOS.includes(dto.estado)) throw new BadRequestException('Estado inválido.');
    if (dto.estado === 'derivado' && !dto.agencia?.trim()) {
      throw new BadRequestException('Para derivar se requiere la agencia destino.');
    }
    caso.estado = dto.estado;
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    return this.repo.save(caso);
  }

  /** Siembra datos de demostración para el tenant 'demo' si aún no tiene casos. */
  private async seed(): Promise<void> {
    const ya = await this.repo.count({ where: { tenant: 'demo' } });
    if (ya > 0) return;

    const base: Array<Partial<CasoEntity>> = [
      { canal: 'llamada', titulo: 'Riña en vía pública', ciudadano: 'María Gómez', telefono: '3001112233', agencia: 'Policía', estado: 'nuevo' },
      { canal: 'chat', titulo: 'Reporte de semáforo dañado', ciudadano: 'Carlos Ruiz', agencia: 'Tránsito', estado: 'en_gestion' },
      { canal: 'integracion', titulo: 'Alarma activada — comercio', ciudadano: 'Sistema Alarmas', agencia: 'Policía', estado: 'nuevo' },
    ];
    for (const b of base) {
      await this.repo.save(this.repo.create({ ...b, tenant: 'demo', descripcion: '', creadoPor: 'seed' }));
    }
  }
}
