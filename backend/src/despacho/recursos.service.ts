import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadoRecurso, RecursoEntity, TIPOS_RECURSO, TipoRecurso } from './recurso.entity';

export interface CrearRecursoDto {
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  agencia?: string;
  lat?: number;
  lng?: number;
}

export interface ActualizarRecursoDto {
  nombre?: string;
  tipo?: TipoRecurso;
  agencia?: string;
  activo?: boolean;
  fueraServicio?: boolean;
  lat?: number;
  lng?: number;
}

/** Gestión de la flota de recursos (unidades). Acotada por tenant. */
@Injectable()
export class RecursosService implements OnModuleInit {
  constructor(
    @InjectRepository(RecursoEntity)
    private readonly repo: Repository<RecursoEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  listar(tenant: string): Promise<RecursoEntity[]> {
    return this.repo.find({ where: { tenant }, order: { codigo: 'ASC' } });
  }

  /** Recursos libres para despachar. */
  disponibles(tenant: string): Promise<RecursoEntity[]> {
    return this.repo.find({ where: { tenant, activo: true, estado: 'disponible' }, order: { codigo: 'ASC' } });
  }

  async crear(tenant: string, dto: CrearRecursoDto): Promise<RecursoEntity> {
    const codigo = dto.codigo?.trim().toUpperCase();
    if (!codigo || !dto.nombre?.trim()) throw new BadRequestException('Código y nombre son obligatorios.');
    if (!TIPOS_RECURSO.includes(dto.tipo)) throw new BadRequestException('Tipo de recurso inválido.');
    if (await this.repo.findOne({ where: { tenant, codigo } })) {
      throw new ConflictException('Ya existe un recurso con ese código.');
    }
    return this.repo.save(
      this.repo.create({
        tenant,
        codigo,
        nombre: dto.nombre.trim(),
        tipo: dto.tipo,
        agencia: dto.agencia?.trim() || 'Central',
        estado: 'disponible',
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        activo: true,
      }),
    );
  }

  async actualizar(tenant: string, id: string, dto: ActualizarRecursoDto): Promise<RecursoEntity> {
    const r = await this.obtener(tenant, id);
    if (dto.nombre?.trim()) r.nombre = dto.nombre.trim();
    if (dto.tipo && TIPOS_RECURSO.includes(dto.tipo)) r.tipo = dto.tipo;
    if (dto.agencia?.trim()) r.agencia = dto.agencia.trim();
    if (typeof dto.lat === 'number') r.lat = dto.lat;
    if (typeof dto.lng === 'number') r.lng = dto.lng;
    if (typeof dto.activo === 'boolean') r.activo = dto.activo;
    // Sacar/entrar de servicio solo si el recurso no está comprometido.
    if (typeof dto.fueraServicio === 'boolean') {
      if (r.estado !== 'disponible' && r.estado !== 'fuera_servicio') {
        throw new BadRequestException('No se puede cambiar el servicio de un recurso en atención.');
      }
      r.estado = dto.fueraServicio ? 'fuera_servicio' : 'disponible';
    }
    return this.repo.save(r);
  }

  async obtener(tenant: string, id: string): Promise<RecursoEntity> {
    const r = await this.repo.findOne({ where: { tenant, id } });
    if (!r) throw new NotFoundException('Recurso no encontrado.');
    return r;
  }

  /** Cambia el estado operativo del recurso (lo usa el despacho). */
  async setEstado(recurso: RecursoEntity, estado: EstadoRecurso): Promise<RecursoEntity> {
    recurso.estado = estado;
    return this.repo.save(recurso);
  }

  private async seed(): Promise<void> {
    if (await this.repo.count({ where: { tenant: 'demo' } })) return;
    const demo: Array<Partial<RecursoEntity>> = [
      { codigo: 'P-01', nombre: 'Patrulla 01', tipo: 'patrulla', agencia: 'Policía' },
      { codigo: 'P-02', nombre: 'Patrulla 02', tipo: 'patrulla', agencia: 'Policía' },
      { codigo: 'AMB-1', nombre: 'Ambulancia 1', tipo: 'ambulancia', agencia: 'Salud' },
      { codigo: 'M-1', nombre: 'Máquina 1', tipo: 'maquina', agencia: 'Bomberos' },
    ];
    for (const r of demo) {
      await this.repo.save(this.repo.create({ ...r, tenant: 'demo', estado: 'disponible', activo: true }));
    }
  }
}
