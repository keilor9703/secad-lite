import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { EntidadEntity } from './entidad.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';

/** Payload que una entidad externa envía para radicar un caso. */
export interface RadicarCasoDto {
  titulo: string;
  descripcion?: string;
  ciudadano?: string;
  telefono?: string;
  agencia?: string;
  lat?: number;
  lng?: number;
  /** Referencia del caso en el sistema de la entidad (para su trazabilidad). */
  referencia?: string;
}

export interface CrearEntidadDto {
  nombre: string;
  agencia?: string;
}

export interface ActualizarEntidadDto {
  nombre?: string;
  agencia?: string;
  activa?: boolean;
}

/**
 * API entrante: entidades externas radican casos en FALCON CAD autenticándose
 * con su API key. Cada caso queda con canal 'integracion', enlazado a la
 * entidad (entidadId) para que esta pueda consultar su estado.
 */
@Injectable()
export class IntegracionService {
  constructor(
    @InjectRepository(EntidadEntity) private readonly entidades: Repository<EntidadEntity>,
    @InjectRepository(CasoEntity) private readonly casos: Repository<CasoEntity>,
    private readonly casosSvc: CasosService,
  ) {}

  // --- API pública (x-api-key) ----------------------------------------------

  /** Radica un caso a nombre de la entidad dueña de la API key. */
  async radicar(apiKey: string, dto: RadicarCasoDto) {
    const entidad = await this.porApiKey(apiKey);
    if (!dto?.titulo?.trim()) throw new BadRequestException('El título es obligatorio.');

    const descripcion = [dto.descripcion?.trim(), dto.referencia?.trim() ? `Referencia externa: ${dto.referencia.trim()}` : '']
      .filter(Boolean).join('\n');

    const caso = await this.casosSvc.crear(
      entidad.tenant,
      {
        canal: 'integracion',
        titulo: dto.titulo.trim(),
        descripcion,
        ciudadano: dto.ciudadano?.trim() || entidad.nombre,
        telefono: dto.telefono?.trim(),
        agencia: dto.agencia?.trim() || entidad.agencia,
        lat: dto.lat,
        lng: dto.lng,
        entidadId: entidad.id,
      },
      `entidad:${entidad.nombre}`,
    );
    return { casoId: caso.id, estado: caso.estado, titulo: caso.titulo, creadoEn: caso.creadoEn };
  }

  /** Estado de un caso radicado por la MISMA entidad (seguimiento). */
  async consultar(apiKey: string, casoId: string) {
    const entidad = await this.porApiKey(apiKey);
    const caso = await this.casos.findOne({ where: { tenant: entidad.tenant, id: casoId, entidadId: entidad.id } });
    if (!caso) throw new NotFoundException('Caso no encontrado para esta entidad.');
    return {
      casoId: caso.id, estado: caso.estado, titulo: caso.titulo,
      agencia: caso.agencia, creadoEn: caso.creadoEn, actualizadoEn: caso.actualizadoEn,
    };
  }

  // --- Gestión (permiso entidades.gestionar) --------------------------------

  listar(tenant: string): Promise<EntidadEntity[]> {
    return this.entidades.find({ where: { tenant }, order: { nombre: 'ASC' } });
  }

  async crear(tenant: string, dto: CrearEntidadDto): Promise<EntidadEntity> {
    const nombre = dto?.nombre?.trim();
    if (!nombre) throw new BadRequestException('El nombre de la entidad es obligatorio.');
    if (await this.entidades.findOne({ where: { tenant, nombre } })) {
      throw new ConflictException('Ya existe una entidad con ese nombre.');
    }
    return this.entidades.save(
      this.entidades.create({
        tenant, nombre,
        agencia: dto.agencia?.trim() || 'Central',
        apiKey: this.generarKey(),
        activa: true,
      }),
    );
  }

  async actualizar(tenant: string, id: string, dto: ActualizarEntidadDto): Promise<EntidadEntity> {
    const e = await this.obtener(tenant, id);
    if (dto.nombre?.trim()) e.nombre = dto.nombre.trim();
    if (dto.agencia?.trim()) e.agencia = dto.agencia.trim();
    if (typeof dto.activa === 'boolean') e.activa = dto.activa;
    return this.entidades.save(e);
  }

  async rotarKey(tenant: string, id: string): Promise<EntidadEntity> {
    const e = await this.obtener(tenant, id);
    e.apiKey = this.generarKey();
    return this.entidades.save(e);
  }

  // ---------------------------------------------------------------------------
  private async obtener(tenant: string, id: string): Promise<EntidadEntity> {
    const e = await this.entidades.findOne({ where: { tenant, id } });
    if (!e) throw new NotFoundException('Entidad no encontrada.');
    return e;
  }

  private async porApiKey(apiKey: string): Promise<EntidadEntity> {
    if (!apiKey?.trim()) throw new UnauthorizedException('Falta la API key (header x-api-key).');
    const e = await this.entidades.findOne({ where: { apiKey: apiKey.trim() } });
    if (!e || !e.activa) throw new UnauthorizedException('API key inválida o entidad inactiva.');
    return e;
  }

  private generarKey(): string {
    return 'ek_' + randomBytes(24).toString('hex');
  }
}
