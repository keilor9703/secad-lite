import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolEntity } from './rol.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { CLAVES_PERMISO, esPermisoValido, PERMISOS } from './permiso.catalogo';

export interface CrearRolDto {
  nombre: string;
  permisos: string[];
}
export interface ActualizarRolDto {
  nombre?: string;
  permisos?: string[];
}

/** Roles de sistema que se siembran en cada tenant, con sus permisos por defecto. */
const DEFAULTS: Array<{ codigo: string; nombre: string; permisos: string[] }> = [
  { codigo: 'admin', nombre: 'Administrador', permisos: [...CLAVES_PERMISO] },
  {
    codigo: 'supervisor', nombre: 'Supervisor',
    permisos: ['casos.ver', 'casos.ver_todos', 'casos.crear', 'casos.gestionar', 'casos.cerrar', 'casos.reabrir', 'despacho.ver', 'despacho.asignar', 'recursos.ver', 'recursos.gestionar', 'pbx.usar', 'whatsapp.responder', 'metricas.ver'],
  },
  {
    codigo: 'operador', nombre: 'Operador',
    // El operador ve solo lo de sus canales (sin casos.ver_todos) y no reabre
    // lo que cierra: la reapertura la autoriza un supervisor.
    permisos: ['casos.ver', 'casos.crear', 'casos.gestionar', 'casos.cerrar', 'despacho.ver', 'despacho.asignar', 'recursos.ver', 'pbx.usar', 'whatsapp.responder'],
  },
];

/**
 * Roles y permisos por tenant (RBAC dinámico). Cada tenant arranca con los roles
 * de sistema y puede crear roles a medida marcando permisos del catálogo fijo.
 */
@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    @InjectRepository(RolEntity) private readonly repo: Repository<RolEntity>,
    @InjectRepository(UsuarioEntity) private readonly usuarios: Repository<UsuarioEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.asegurarSeed('demo');
  }

  /** Catálogo de permisos (columnas de la matriz). */
  catalogo() {
    return PERMISOS;
  }

  /** Siembra los roles de sistema del tenant si aún no tiene ninguno. */
  async asegurarSeed(tenant: string): Promise<void> {
    if (!tenant) return;
    if (await this.repo.count({ where: { tenant } })) return;
    for (const d of DEFAULTS) {
      await this.repo.save(this.repo.create({ tenant, codigo: d.codigo, nombre: d.nombre, permisos: d.permisos, esSistema: true }));
    }
  }

  async listar(tenant: string): Promise<RolEntity[]> {
    await this.asegurarSeed(tenant);
    return this.repo.find({ where: { tenant }, order: { esSistema: 'DESC', nombre: 'ASC' } });
  }

  async crear(tenant: string, dto: CrearRolDto): Promise<RolEntity> {
    const nombre = dto?.nombre?.trim();
    if (!nombre) throw new BadRequestException('El nombre del rol es obligatorio.');
    const permisos = this.validarPermisos(dto?.permisos);
    const codigo = this.slug(nombre);
    if (!codigo) throw new BadRequestException('El nombre del rol no es válido.');
    if (codigo === 'superadmin' || codigo === 'ciudadano') {
      throw new BadRequestException('Ese nombre de rol está reservado.');
    }
    await this.asegurarSeed(tenant);
    if (await this.repo.findOne({ where: { tenant, codigo } })) {
      throw new ConflictException('Ya existe un rol con ese nombre.');
    }
    return this.repo.save(this.repo.create({ tenant, codigo, nombre, permisos, esSistema: false }));
  }

  async actualizar(tenant: string, id: string, dto: ActualizarRolDto): Promise<RolEntity> {
    const rol = await this.repo.findOne({ where: { tenant, id } });
    if (!rol) throw new NotFoundException('Rol no encontrado.');
    if (dto.nombre?.trim() && !rol.esSistema) rol.nombre = dto.nombre.trim();
    if (dto.permisos !== undefined) rol.permisos = this.validarPermisos(dto.permisos);
    return this.repo.save(rol);
  }

  async eliminar(tenant: string, id: string): Promise<{ ok: true }> {
    const rol = await this.repo.findOne({ where: { tenant, id } });
    if (!rol) throw new NotFoundException('Rol no encontrado.');
    if (rol.esSistema) throw new ForbiddenException('No se puede eliminar un rol de sistema.');
    const enUso = await this.usuarios.count({ where: { tenant, rol: rol.codigo } });
    if (enUso > 0) throw new ConflictException(`El rol está asignado a ${enUso} usuario(s).`);
    await this.repo.remove(rol);
    return { ok: true };
  }

  /** Permisos efectivos de un rol (para el guard y el token). */
  async permisosDe(tenant: string | null, codigo: string): Promise<string[]> {
    if (codigo === 'superadmin') return [...CLAVES_PERMISO];
    if (!tenant) return [];
    await this.asegurarSeed(tenant);
    const rol = await this.repo.findOne({ where: { tenant, codigo } });
    return rol?.permisos ?? [];
  }

  /** ¿Existe ese rol (por código) en el tenant? */
  async existe(tenant: string, codigo: string): Promise<boolean> {
    await this.asegurarSeed(tenant);
    return !!(await this.repo.findOne({ where: { tenant, codigo } }));
  }

  // ---------------------------------------------------------------------------
  private validarPermisos(permisos?: string[]): string[] {
    if (!Array.isArray(permisos)) return [];
    const limpios = [...new Set(permisos.map((p) => String(p).trim()))].filter(Boolean);
    const invalido = limpios.find((p) => !esPermisoValido(p));
    if (invalido) throw new BadRequestException(`Permiso inválido: ${invalido}.`);
    return limpios;
  }

  private slug(nombre: string): string {
    return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
}
