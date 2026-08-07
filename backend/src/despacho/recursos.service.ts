import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadoRecurso, RecursoEntity, TIPOS_RECURSO, TipoRecurso } from './recurso.entity';
import { CatalogosService } from '../catalogos/catalogos.service';
import { ReferenciasService } from '../catalogos/referencias.service';

export interface CrearRecursoDto {
  codigo: string;
  nombre: string;
  tipo: TipoRecurso;
  /** Agencia dueña (agencias.id); sale del catálogo, no se escribe a mano. */
  agenciaId?: string | null;
  lat?: number;
  lng?: number;
}

export interface ActualizarRecursoDto {
  codigo?: string;
  nombre?: string;
  tipo?: TipoRecurso;
  agenciaId?: string | null;
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
    private readonly catalogos: CatalogosService,
    private readonly referencias: ReferenciasService,
  ) {}

  /**
   * Resuelve la agencia contra el catálogo del secad. Devuelve el id y el
   * nombre, que se guarda denormalizado para no reconsultar en cada listado.
   */
  private async agenciaDelCatalogo(tenant: string, id?: string | null) {
    if (!id) return { agenciaId: null, agencia: 'Central' };
    const a = await this.catalogos.agenciaDe(tenant, id);
    return { agenciaId: a.id, agencia: a.nombre };
  }

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
    const agencia = await this.agenciaDelCatalogo(tenant, dto.agenciaId);
    return this.repo.save(
      this.repo.create({
        tenant,
        codigo,
        nombre: dto.nombre.trim(),
        tipo: dto.tipo,
        ...agencia,
        estado: 'disponible',
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        activo: true,
      }),
    );
  }

  async actualizar(tenant: string, id: string, dto: ActualizarRecursoDto): Promise<RecursoEntity> {
    const r = await this.obtener(tenant, id);
    if (dto.codigo !== undefined) {
      const codigo = dto.codigo.trim().toUpperCase();
      if (!codigo) throw new BadRequestException('El código no puede quedar vacío.');
      if (codigo !== r.codigo && (await this.repo.findOne({ where: { tenant, codigo } }))) {
        throw new ConflictException('Ya existe un recurso con ese código.');
      }
      r.codigo = codigo;
    }
    if (dto.nombre?.trim()) r.nombre = dto.nombre.trim();
    if (dto.tipo && TIPOS_RECURSO.includes(dto.tipo)) r.tipo = dto.tipo;
    if (dto.agenciaId !== undefined) {
      const agencia = await this.agenciaDelCatalogo(tenant, dto.agenciaId);
      r.agenciaId = agencia.agenciaId;
      r.agencia = agencia.agencia;
    }
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

  /**
   * Borrado definitivo. Solo procede si el recurso nunca fue despachado: si ya
   * tiene asignaciones, borrarlo dejaría despachos apuntando a una unidad
   * inexistente, así que se ofrece darlo de baja en su lugar.
   */
  async eliminar(tenant: string, id: string): Promise<{ ok: true }> {
    const r = await this.obtener(tenant, id);
    if (r.estado !== 'disponible' && r.estado !== 'fuera_servicio') {
      throw new BadRequestException('No se puede eliminar un recurso que está en atención.');
    }
    const refs = await this.referencias.deRecurso(tenant, id);
    if (refs.length) {
      throw new ConflictException(
        `No se puede eliminar: el recurso «${r.codigo}» tiene ${ReferenciasService.resumir(refs)}. ` +
          'Desactívelo en su lugar, así sale de la flota sin borrar la historia.',
      );
    }
    await this.repo.delete({ id, tenant });
    return { ok: true };
  }

  /** Cambia el estado operativo del recurso (lo usa el despacho). */
  async setEstado(recurso: RecursoEntity, estado: EstadoRecurso): Promise<RecursoEntity> {
    recurso.estado = estado;
    return this.repo.save(recurso);
  }

  private async seed(): Promise<void> {
    if (await this.repo.count({ where: { tenant: 'demo' } })) return;
    const demo: Array<Partial<RecursoEntity>> = [
      { codigo: 'P-01', nombre: 'Patrulla 01', tipo: 'patrulla', agencia: 'Policía', lat: 4.6580, lng: -74.0940 },
      { codigo: 'P-02', nombre: 'Patrulla 02', tipo: 'patrulla', agencia: 'Policía', lat: 4.5709, lng: -74.0970 },
      { codigo: 'AMB-1', nombre: 'Ambulancia 1', tipo: 'ambulancia', agencia: 'Salud', lat: 4.6300, lng: -74.0700 },
      { codigo: 'M-1', nombre: 'Máquina 1', tipo: 'maquina', agencia: 'Bomberos', lat: 4.6100, lng: -74.0820 },
    ];
    for (const r of demo) {
      await this.repo.save(this.repo.create({ ...r, tenant: 'demo', estado: 'disponible', activo: true }));
    }
  }
}
