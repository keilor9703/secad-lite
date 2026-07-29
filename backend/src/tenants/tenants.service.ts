import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';

export interface CrearTenantDto {
  codigo: string;
  nombre: string;
}

/** Gestión de tenants (instancias). Solo el superadmin la usa. */
@Injectable()
export class TenantsService implements OnModuleInit {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly repo: Repository<TenantEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!(await this.repo.count())) {
      await this.repo.save(this.repo.create({ codigo: 'demo', nombre: 'Municipio Demo', activo: true }));
    }
  }

  listar(): Promise<TenantEntity[]> {
    return this.repo.find({ order: { codigo: 'ASC' } });
  }

  async crear(dto: CrearTenantDto): Promise<TenantEntity> {
    const codigo = dto.codigo?.trim().toLowerCase();
    if (!codigo || !dto.nombre?.trim()) throw new BadRequestException('Código y nombre son obligatorios.');
    if (!/^[a-z0-9-]{2,64}$/.test(codigo)) {
      throw new BadRequestException('El código solo admite minúsculas, números y guiones (2-64).');
    }
    if (await this.repo.findOne({ where: { codigo } })) {
      throw new ConflictException('Ya existe un tenant con ese código.');
    }
    return this.repo.save(this.repo.create({ codigo, nombre: dto.nombre.trim(), activo: true }));
  }

  async cambiarActivo(id: string, activo: boolean): Promise<TenantEntity> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tenant no encontrado.');
    t.activo = activo;
    return this.repo.save(t);
  }
}
