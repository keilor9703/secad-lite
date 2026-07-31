import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from './usuario.entity';
import { RolesService } from '../roles/roles.service';

/** Contexto del actor autenticado (subconjunto del JWT). */
export interface Actor {
  sub: string;
  rol: string;
  tenant?: string | null;
}

/** Vista pública de un usuario (sin el hash de contraseña). */
export interface UsuarioDto {
  id: string;
  username: string;
  nombre: string;
  rol: string;
  tenant: string | null;
  activo: boolean;
}

export interface CrearUsuarioDto {
  username: string;
  nombre: string;
  contrasena: string;
  rol: string;
  tenant?: string;
}

export interface ActualizarUsuarioDto {
  nombre?: string;
  rol?: string;
  activo?: boolean;
  contrasena?: string;
}

/**
 * Directorio de usuarios (PostgreSQL, bcrypt). El `username` es único global; el
 * tenant se deduce del usuario. La gestión está acotada por ámbito: el
 * superadmin gobierna todos los tenants; el admin, solo el suyo. El rol que se
 * asigna debe existir en el tenant (RBAC dinámico, ver RolesService).
 */
@Injectable()
export class UsuariosService implements OnModuleInit {
  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly repo: Repository<UsuarioEntity>,
    private readonly roles: RolesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  buscarPorUsername(username: string): Promise<UsuarioEntity | null> {
    return this.repo.findOne({ where: { username: username.trim().toLowerCase(), activo: true } });
  }

  /** Valida credenciales; devuelve el usuario o null. */
  async validar(username: string, contrasena: string): Promise<UsuarioEntity | null> {
    const u = await this.buscarPorUsername(username);
    if (!u) return null;
    return (await bcrypt.compare(contrasena, u.passwordHash)) ? u : null;
  }

  // --- Gestión (usuarios.gestionar) -----------------------------------------

  /** Superadmin ve todos; los demás ven solo los de su tenant. */
  async listar(actor: Actor): Promise<UsuarioDto[]> {
    const where = actor.rol === 'superadmin' ? {} : { tenant: actor.tenant ?? '' };
    const usuarios = await this.repo.find({ where, order: { username: 'ASC' } });
    return usuarios.map((u) => this.aDto(u));
  }

  async crear(actor: Actor, dto: CrearUsuarioDto): Promise<UsuarioDto> {
    const username = dto.username?.trim().toLowerCase();
    if (!username || !dto.contrasena || !dto.nombre?.trim()) {
      throw new BadRequestException('Usuario, nombre y contraseña son obligatorios.');
    }
    const { rol, tenant } = await this.resolverAmbito(actor, dto.rol, dto.tenant);

    if (await this.repo.findOne({ where: { username } })) {
      throw new ConflictException('Ese nombre de usuario ya existe.');
    }

    const u = await this.repo.save(
      this.repo.create({
        username,
        nombre: dto.nombre.trim(),
        passwordHash: await bcrypt.hash(dto.contrasena, 10),
        rol,
        tenant,
        activo: true,
      }),
    );
    return this.aDto(u);
  }

  async actualizar(actor: Actor, id: string, dto: ActualizarUsuarioDto): Promise<UsuarioDto> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('Usuario no encontrado.');
    if (actor.rol !== 'superadmin' && u.tenant !== actor.tenant) {
      throw new ForbiddenException('No puede gestionar usuarios de otro tenant.');
    }
    if (dto.rol) u.rol = (await this.resolverAmbito(actor, dto.rol, u.tenant ?? undefined)).rol;
    if (dto.nombre?.trim()) u.nombre = dto.nombre.trim();
    if (typeof dto.activo === 'boolean') u.activo = dto.activo;
    if (dto.contrasena) u.passwordHash = await bcrypt.hash(dto.contrasena, 10);
    return this.aDto(await this.repo.save(u));
  }

  /**
   * Valida el rol/tenant que el actor intenta asignar y devuelve los efectivos.
   *  - superadmin: 'superadmin' (sin tenant) o cualquier rol existente del tenant.
   *  - resto: cualquier rol existente de su propio tenant (nunca superadmin).
   */
  private async resolverAmbito(actor: Actor, rol: string, tenant?: string | null): Promise<{ rol: string; tenant: string | null }> {
    if (actor.rol === 'superadmin') {
      if (rol === 'superadmin') return { rol, tenant: null };
      if (!tenant?.trim()) throw new BadRequestException('Debe indicar el tenant del usuario.');
      if (!(await this.roles.existe(tenant.trim(), rol))) {
        throw new BadRequestException('Ese rol no existe en el tenant.');
      }
      return { rol, tenant: tenant.trim() };
    }
    if (rol === 'superadmin') throw new ForbiddenException('No puede asignar el rol superadmin.');
    const t = actor.tenant ?? '';
    if (!(await this.roles.existe(t, rol))) {
      throw new ForbiddenException('No puede asignar ese rol.');
    }
    return { rol, tenant: t };
  }

  private aDto(u: UsuarioEntity): UsuarioDto {
    return { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, tenant: u.tenant ?? null, activo: u.activo };
  }

  /**
   * Siembra el superadmin global y los usuarios demo del tenant 'demo'.
   * Idempotente: en una base existente agrega solo lo que falte.
   */
  private async seed(): Promise<void> {
    const hash = await bcrypt.hash('demo', 10);

    if (!(await this.repo.findOne({ where: { rol: 'superadmin' } }))) {
      await this.repo.save(
        this.repo.create({ username: 'superadmin', nombre: 'Super Administrador', rol: 'superadmin', tenant: null, passwordHash: hash, activo: true }),
      );
    }

    if (!(await this.repo.findOne({ where: { tenant: 'demo' } }))) {
      const demo: Array<Partial<UsuarioEntity>> = [
        { username: 'admin1', nombre: 'Administrador', rol: 'admin', tenant: 'demo' },
        { username: 'supervisor1', nombre: 'Supervisor Uno', rol: 'supervisor', tenant: 'demo' },
        { username: 'operador1', nombre: 'Operador Uno', rol: 'operador', tenant: 'demo' },
      ];
      for (const f of demo) await this.repo.save(this.repo.create({ ...f, passwordHash: hash, activo: true }));
    }
  }
}
