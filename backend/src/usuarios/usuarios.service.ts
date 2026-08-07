import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsuarioEntity } from './usuario.entity';
import { RolesService } from '../roles/roles.service';
import { CatalogosService } from '../catalogos/catalogos.service';

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
  /** Agencia a la que pertenece (agencias.id). */
  agenciaId: string | null;
  /** Canales de atención asignados (canales.id). */
  canales: string[];
  /** Extensión de la planta telefónica; null si no atiende llamadas por PBX. */
  extension: string | null;
}

export interface CrearUsuarioDto {
  username: string;
  nombre: string;
  contrasena: string;
  rol: string;
  tenant?: string;
  agenciaId?: string | null;
  canales?: string[];
  extension?: string | null;
}

export interface ActualizarUsuarioDto {
  nombre?: string;
  rol?: string;
  activo?: boolean;
  contrasena?: string;
  agenciaId?: string | null;
  canales?: string[];
  extension?: string | null;
}

/**
 * Directorio de usuarios (PostgreSQL, bcrypt). El `username` es único DENTRO
 * de cada tenant, no global: dos secads pueden tener cada uno su propio
 * "admin". La gestión está acotada por ámbito: el superadmin gobierna todos
 * los tenants; el admin, solo el suyo. El rol que se asigna debe existir en
 * el tenant (RBAC dinámico, ver RolesService).
 */
@Injectable()
export class UsuariosService implements OnModuleInit {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(
    @InjectRepository(UsuarioEntity)
    private readonly repo: Repository<UsuarioEntity>,
    private readonly roles: RolesService,
    private readonly catalogos: CatalogosService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /**
   * La cuenta activa de ESE tenant con ese username. Úsese siempre que el
   * tenant ya se conozca (viaja en el JWT) — es la búsqueda sin ambigüedad.
   * `tenant: null` es el caso del superadmin (no pertenece a ningún tenant).
   */
  buscarPorUsernameYTenant(username: string, tenant: string | null): Promise<UsuarioEntity | null> {
    return this.repo.findOne({
      where: { username: username.trim().toLowerCase(), tenant: tenant ?? IsNull(), activo: true },
    });
  }

  /**
   * Cuentas activas con ese username, en cualquier tenant. Como el username
   * solo es único DENTRO de cada tenant, puede haber más de una — se usa
   * solo en el login, que todavía no sabe a qué tenant pertenece quien
   * escribe.
   */
  private buscarActivosPorUsername(username: string): Promise<UsuarioEntity[]> {
    return this.repo.find({ where: { username: username.trim().toLowerCase(), activo: true } });
  }

  /**
   * Valida credenciales. Prueba la contraseña contra cada cuenta activa con
   * ese username hasta encontrar la que corresponde — así se resuelve, sin
   * pedir el tenant en el login, cuál de las cuentas (si hay varias con el
   * mismo username en distintos tenants) es la del que está entrando.
   */
  async validar(username: string, contrasena: string): Promise<UsuarioEntity | null> {
    const candidatos = await this.buscarActivosPorUsername(username);
    for (const u of candidatos) {
      if (await bcrypt.compare(contrasena, u.passwordHash)) return u;
    }
    return null;
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

    // Único DENTRO del tenant: el mismo username puede existir en otro
    // secad sin conflicto (o, para el superadmin, entre las cuentas sin
    // tenant).
    if (await this.repo.findOne({ where: { username, tenant: tenant ?? IsNull() } })) {
      throw new ConflictException('Ese nombre de usuario ya existe en este tenant.');
    }

    const { agenciaId, canales } = await this.resolverAdscripcion(tenant, dto.agenciaId, dto.canales);
    const extension = await this.resolverExtension(tenant, dto.extension, null);

    const u = await this.repo.save(
      this.repo.create({
        username,
        nombre: dto.nombre.trim(),
        passwordHash: await bcrypt.hash(dto.contrasena, 10),
        rol,
        tenant,
        agenciaId,
        canales,
        extension,
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
    if (u.rol === 'superadmin') {
      // La cuenta superadmin es la llave maestra: degradarla o desactivarla deja
      // el sistema sin nadie que pueda entrar a Administración.
      if (dto.rol && dto.rol !== 'superadmin') {
        throw new ForbiddenException('No se puede cambiar el rol del superadmin.');
      }
      if (dto.activo === false) throw new ForbiddenException('No se puede desactivar al superadmin.');
    }
    if (dto.rol) u.rol = (await this.resolverAmbito(actor, dto.rol, u.tenant ?? undefined)).rol;
    if (dto.nombre?.trim()) u.nombre = dto.nombre.trim();
    if (typeof dto.activo === 'boolean') u.activo = dto.activo;
    if (dto.contrasena) u.passwordHash = await bcrypt.hash(dto.contrasena, 10);
    if (dto.agenciaId !== undefined || dto.canales !== undefined) {
      const adscripcion = await this.resolverAdscripcion(
        u.tenant ?? null,
        dto.agenciaId !== undefined ? dto.agenciaId : u.agenciaId,
        dto.canales !== undefined ? dto.canales : u.canales ?? [],
      );
      u.agenciaId = adscripcion.agenciaId;
      u.canales = adscripcion.canales;
    }
    if (dto.extension !== undefined) {
      u.extension = await this.resolverExtension(u.tenant ?? null, dto.extension, u.id);
    }
    return this.aDto(await this.repo.save(u));
  }

  /**
   * Extensión del funcionario, en un secad concreto: única por tenant, para
   * que el webhook de la PBX pueda resolver sin ambigüedad a quién dirigir la
   * llamada que el ACD ya enrutó a esa extensión.
   */
  private async resolverExtension(
    tenant: string | null, extension: string | null | undefined, propioId: string | null,
  ): Promise<string | null> {
    if (extension === undefined) return null;
    const valor = extension?.trim();
    if (!valor) return null;
    if (!tenant) throw new BadRequestException('Solo un usuario de un tenant puede tener extensión.');
    const enUso = await this.repo.findOne({ where: { tenant, extension: valor } });
    if (enUso && enUso.id !== propioId) {
      throw new ConflictException('Esa extensión ya está asignada a otro funcionario.');
    }
    return valor;
  }

  /** El funcionario dueño de esa extensión en el secad; null si no hay match. */
  async buscarPorExtension(tenant: string, extension: string): Promise<UsuarioEntity | null> {
    const valor = extension?.trim();
    if (!valor) return null;
    return this.repo.findOne({ where: { tenant, extension: valor, activo: true } });
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

  /**
   * Valida la agencia y los canales del funcionario: ambos deben existir en su
   * secad, y los canales deben pertenecer a su agencia — un funcionario solo
   * atiende las colas de la entidad de la que hace parte.
   */
  private async resolverAdscripcion(
    tenant: string | null,
    agenciaId?: string | null,
    canales?: string[] | null,
  ): Promise<{ agenciaId: string | null; canales: string[] }> {
    if (!tenant || !agenciaId) return { agenciaId: null, canales: [] };
    const agencia = await this.catalogos.agenciaDe(tenant, agenciaId);
    const validos = await this.catalogos.validarCanales(tenant, canales ?? [], agencia.id);
    return { agenciaId: agencia.id, canales: validos.map((c) => c.id) };
  }

  private aDto(u: UsuarioEntity): UsuarioDto {
    return {
      id: u.id, username: u.username, nombre: u.nombre, rol: u.rol,
      tenant: u.tenant ?? null, activo: u.activo,
      agenciaId: u.agenciaId ?? null, canales: u.canales ?? [],
      extension: u.extension ?? null,
    };
  }

  /**
   * Restaura la cuenta `superadmin` si su rol o su tenant quedaron desviados
   * (edición manual en la base, importación de datos, migración a medias). Sin
   * el rol reservado no resuelve permisos: pierde el acceso a Administración y
   * recibe 403 en todo, sin forma de arreglarlo desde la interfaz.
   */
  private async repararSuperadmin(): Promise<void> {
    const u = await this.repo.findOne({ where: { username: 'superadmin' } });
    if (!u) return;
    if (u.rol === 'superadmin' && u.tenant === null && u.activo) return;
    const antes = `rol=${u.rol} tenant=${u.tenant ?? 'null'} activo=${u.activo}`;
    u.rol = 'superadmin';
    u.tenant = null;
    u.activo = true;
    await this.repo.save(u);
    this.logger.warn(`Cuenta superadmin restaurada a sus valores reservados (estaba con ${antes}).`);
  }

  /**
   * Siembra el superadmin global y los usuarios demo del tenant 'demo'.
   * Idempotente por `username` (la llave única real de la tabla): en una base
   * existente agrega solo lo que falte, y un fallo del seed no impide arrancar.
   */
  private async seed(): Promise<void> {
    try {
      const hash = await bcrypt.hash('demo', 10);
      const asegurar = async (f: Partial<UsuarioEntity>) => {
        if (await this.repo.findOne({ where: { username: f.username } })) return;
        await this.repo.save(this.repo.create({ ...f, passwordHash: hash, activo: true }));
      };

      await asegurar({ username: 'superadmin', nombre: 'Super Administrador', rol: 'superadmin', tenant: null });
      await this.repararSuperadmin();

      if (!(await this.repo.findOne({ where: { tenant: 'demo' } }))) {
        await asegurar({ username: 'admin1', nombre: 'Administrador', rol: 'admin', tenant: 'demo' });
        await asegurar({ username: 'supervisor1', nombre: 'Supervisor Uno', rol: 'supervisor', tenant: 'demo' });
        await asegurar({ username: 'operador1', nombre: 'Operador Uno', rol: 'operador', tenant: 'demo' });
      }

      // Los usuarios de demostración quedan adscritos a la central de
      // emergencias: sin agencia no podrían recepcionar con origen.
      await this.catalogos.asegurarSeed('demo');
      const central = (await this.catalogos.listarAgencias('demo')).find((a) => a.codigo === 'CENTRAL');
      if (central) {
        await this.repo.update({ tenant: 'demo', agenciaId: IsNull() }, { agenciaId: central.id });
      }
    } catch (e) {
      this.logger.warn(`Seed de usuarios demo omitido: ${(e as Error).message}`);
    }
  }
}
