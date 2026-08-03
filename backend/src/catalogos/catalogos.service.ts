import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AgenciaEntity, TIPOS_AGENCIA, TipoAgencia } from './agencia.entity';
import { CanalEntity } from './canal.entity';
import { CodigoCasoEntity, PRIORIDADES, PrioridadCaso } from './codigo-caso.entity';

export interface CrearAgenciaDto { codigo: string; nombre: string; tipo?: TipoAgencia; telefono?: string; }
export interface ActualizarAgenciaDto { nombre?: string; tipo?: TipoAgencia; telefono?: string; activo?: boolean; }
export interface CrearCanalDto { agenciaId: string; codigo: string; nombre: string; }
export interface ActualizarCanalDto { nombre?: string; activo?: boolean; }
export interface CrearCodigoCasoDto { codigo: string; descripcion: string; prioridad?: PrioridadCaso; agenciaSugeridaId?: string | null; }
export interface ActualizarCodigoCasoDto { descripcion?: string; prioridad?: PrioridadCaso; agenciaSugeridaId?: string | null; activo?: boolean; }

/** Catálogo inicial de cada secad: sin esto no se puede recepcionar nada. */
const SEMILLA: Array<{ codigo: string; nombre: string; tipo: TipoAgencia; canales: Array<[string, string]> }> = [
  { codigo: 'POLICIA', nombre: 'Policía Nacional', tipo: 'policia', canales: [['C1', 'Cuadrante 1'], ['C2', 'Cuadrante 2'], ['CAI', 'CAI Centro']] },
  { codigo: 'BOMBEROS', nombre: 'Cuerpo de Bomberos', tipo: 'bomberos', canales: [['M1', 'Máquina 1'], ['M2', 'Máquina 2']] },
  { codigo: 'SALUD', nombre: 'Salud — Ambulancias', tipo: 'salud', canales: [['A1', 'Ambulancia 1'], ['A2', 'Ambulancia 2']] },
  { codigo: 'TRANSITO', nombre: 'Secretaría de Tránsito', tipo: 'transito', canales: [['T1', 'Agentes de tránsito']] },
  { codigo: 'CENTRAL', nombre: 'Central de emergencias', tipo: 'otra', canales: [['REC', 'Recepción']] },
];

const SEMILLA_CODIGOS: Array<[string, string, PrioridadCaso, string]> = [
  ['101', 'Riña o alteración del orden', 'media', 'POLICIA'],
  ['102', 'Hurto en curso', 'alta', 'POLICIA'],
  ['103', 'Persona sospechosa', 'baja', 'POLICIA'],
  ['104', 'Violencia intrafamiliar', 'alta', 'POLICIA'],
  ['201', 'Incendio estructural', 'alta', 'BOMBEROS'],
  ['202', 'Fuga de gas', 'alta', 'BOMBEROS'],
  ['203', 'Rescate o atrapamiento', 'alta', 'BOMBEROS'],
  ['301', 'Emergencia médica', 'alta', 'SALUD'],
  ['302', 'Traslado asistencial', 'baja', 'SALUD'],
  ['401', 'Accidente de tránsito con heridos', 'alta', 'TRANSITO'],
  ['402', 'Accidente de tránsito sin heridos', 'media', 'TRANSITO'],
  ['403', 'Vehículo mal estacionado', 'baja', 'TRANSITO'],
];

/**
 * Catálogos operativos del secad: agencias, sus canales de atención y los
 * códigos de caso. Todo va acotado por tenant. La primera lectura de un secad
 * siembra un catálogo base para que pueda operar desde el minuto cero.
 */
@Injectable()
export class CatalogosService {
  constructor(
    @InjectRepository(AgenciaEntity) private readonly agencias: Repository<AgenciaEntity>,
    @InjectRepository(CanalEntity) private readonly canales: Repository<CanalEntity>,
    @InjectRepository(CodigoCasoEntity) private readonly codigos: Repository<CodigoCasoEntity>,
  ) {}

  // --- Agencias ---------------------------------------------------------------

  async listarAgencias(tenant: string, soloActivas = false): Promise<AgenciaEntity[]> {
    await this.asegurarSeed(tenant);
    const where = soloActivas ? { tenant, activo: true } : { tenant };
    return this.agencias.find({ where, order: { nombre: 'ASC' } });
  }

  async crearAgencia(tenant: string, dto: CrearAgenciaDto): Promise<AgenciaEntity> {
    const codigo = this.normalizarCodigo(dto.codigo);
    const nombre = dto.nombre?.trim();
    if (!codigo || !nombre) throw new BadRequestException('Código y nombre son obligatorios.');
    if (dto.tipo && !TIPOS_AGENCIA.includes(dto.tipo)) throw new BadRequestException('Tipo de agencia inválido.');
    if (await this.agencias.findOne({ where: { tenant, codigo } })) {
      throw new ConflictException('Ya existe una agencia con ese código.');
    }
    return this.agencias.save(this.agencias.create({
      tenant, codigo, nombre, tipo: dto.tipo ?? 'otra', telefono: dto.telefono?.trim() || null, activo: true,
    }));
  }

  async actualizarAgencia(tenant: string, id: string, dto: ActualizarAgenciaDto): Promise<AgenciaEntity> {
    const a = await this.agencias.findOne({ where: { id, tenant } });
    if (!a) throw new NotFoundException('Agencia no encontrada.');
    if (dto.tipo && !TIPOS_AGENCIA.includes(dto.tipo)) throw new BadRequestException('Tipo de agencia inválido.');
    if (dto.nombre !== undefined) {
      if (!dto.nombre.trim()) throw new BadRequestException('El nombre no puede quedar vacío.');
      a.nombre = dto.nombre.trim();
    }
    if (dto.tipo !== undefined) a.tipo = dto.tipo;
    if (dto.telefono !== undefined) a.telefono = dto.telefono.trim() || null;
    if (dto.activo !== undefined) a.activo = dto.activo;
    return this.agencias.save(a);
  }

  /** Baja lógica: desactiva la agencia y sus canales (nunca se borra historia). */
  async desactivarAgencia(tenant: string, id: string): Promise<{ ok: true }> {
    const a = await this.agencias.findOne({ where: { id, tenant } });
    if (!a) throw new NotFoundException('Agencia no encontrada.');
    a.activo = false;
    await this.agencias.save(a);
    await this.canales.update({ tenant, agenciaId: id }, { activo: false });
    return { ok: true };
  }

  // --- Canales de atención ----------------------------------------------------

  async listarCanales(tenant: string, agenciaId?: string, soloActivos = false): Promise<CanalEntity[]> {
    await this.asegurarSeed(tenant);
    const where: Record<string, unknown> = { tenant };
    if (agenciaId) where['agenciaId'] = agenciaId;
    if (soloActivos) where['activo'] = true;
    return this.canales.find({ where, order: { codigo: 'ASC' } });
  }

  /** Canales indicados, validando que pertenezcan al tenant (y opcionalmente a una agencia). */
  async validarCanales(tenant: string, ids: string[], agenciaId?: string): Promise<CanalEntity[]> {
    const unicos = [...new Set((ids ?? []).filter(Boolean))];
    if (!unicos.length) return [];
    const hallados = await this.canales.find({ where: { tenant, id: In(unicos) } });
    if (hallados.length !== unicos.length) throw new BadRequestException('Algún canal no existe en este secad.');
    if (agenciaId && hallados.some((c) => c.agenciaId !== agenciaId)) {
      throw new BadRequestException('Algún canal no pertenece a la agencia indicada.');
    }
    return hallados;
  }

  async crearCanal(tenant: string, dto: CrearCanalDto): Promise<CanalEntity> {
    const codigo = this.normalizarCodigo(dto.codigo);
    const nombre = dto.nombre?.trim();
    if (!codigo || !nombre) throw new BadRequestException('Código y nombre son obligatorios.');
    const agencia = await this.agencias.findOne({ where: { id: dto.agenciaId, tenant } });
    if (!agencia) throw new BadRequestException('La agencia indicada no existe en este secad.');
    if (await this.canales.findOne({ where: { tenant, agenciaId: agencia.id, codigo } })) {
      throw new ConflictException('Esa agencia ya tiene un canal con ese código.');
    }
    return this.canales.save(this.canales.create({ tenant, agenciaId: agencia.id, codigo, nombre, activo: true }));
  }

  async actualizarCanal(tenant: string, id: string, dto: ActualizarCanalDto): Promise<CanalEntity> {
    const c = await this.canales.findOne({ where: { id, tenant } });
    if (!c) throw new NotFoundException('Canal no encontrado.');
    if (dto.nombre !== undefined) {
      if (!dto.nombre.trim()) throw new BadRequestException('El nombre no puede quedar vacío.');
      c.nombre = dto.nombre.trim();
    }
    if (dto.activo !== undefined) c.activo = dto.activo;
    return this.canales.save(c);
  }

  async desactivarCanal(tenant: string, id: string): Promise<{ ok: true }> {
    const c = await this.canales.findOne({ where: { id, tenant } });
    if (!c) throw new NotFoundException('Canal no encontrado.');
    c.activo = false;
    await this.canales.save(c);
    return { ok: true };
  }

  // --- Códigos de caso --------------------------------------------------------

  async listarCodigos(tenant: string, soloActivos = false): Promise<CodigoCasoEntity[]> {
    await this.asegurarSeed(tenant);
    const where = soloActivos ? { tenant, activo: true } : { tenant };
    return this.codigos.find({ where, order: { codigo: 'ASC' } });
  }

  async crearCodigo(tenant: string, dto: CrearCodigoCasoDto): Promise<CodigoCasoEntity> {
    const codigo = this.normalizarCodigo(dto.codigo);
    const descripcion = dto.descripcion?.trim();
    if (!codigo || !descripcion) throw new BadRequestException('Código y descripción son obligatorios.');
    if (dto.prioridad && !PRIORIDADES.includes(dto.prioridad)) throw new BadRequestException('Prioridad inválida.');
    if (await this.codigos.findOne({ where: { tenant, codigo } })) {
      throw new ConflictException('Ya existe un código de caso con ese código.');
    }
    return this.codigos.save(this.codigos.create({
      tenant, codigo, descripcion,
      prioridad: dto.prioridad ?? 'media',
      agenciaSugeridaId: await this.agenciaValida(tenant, dto.agenciaSugeridaId),
      activo: true,
    }));
  }

  async actualizarCodigo(tenant: string, id: string, dto: ActualizarCodigoCasoDto): Promise<CodigoCasoEntity> {
    const c = await this.codigos.findOne({ where: { id, tenant } });
    if (!c) throw new NotFoundException('Código de caso no encontrado.');
    if (dto.prioridad && !PRIORIDADES.includes(dto.prioridad)) throw new BadRequestException('Prioridad inválida.');
    if (dto.descripcion !== undefined) {
      if (!dto.descripcion.trim()) throw new BadRequestException('La descripción no puede quedar vacía.');
      c.descripcion = dto.descripcion.trim();
    }
    if (dto.prioridad !== undefined) c.prioridad = dto.prioridad;
    if (dto.agenciaSugeridaId !== undefined) c.agenciaSugeridaId = await this.agenciaValida(tenant, dto.agenciaSugeridaId);
    if (dto.activo !== undefined) c.activo = dto.activo;
    return this.codigos.save(c);
  }

  async desactivarCodigo(tenant: string, id: string): Promise<{ ok: true }> {
    const c = await this.codigos.findOne({ where: { id, tenant } });
    if (!c) throw new NotFoundException('Código de caso no encontrado.');
    c.activo = false;
    await this.codigos.save(c);
    return { ok: true };
  }

  // --- Apoyo ------------------------------------------------------------------

  /** Agencia del tenant por id; lanza si no existe. Útil para validar referencias. */
  async agenciaDe(tenant: string, id: string): Promise<AgenciaEntity> {
    const a = await this.agencias.findOne({ where: { id, tenant } });
    if (!a) throw new BadRequestException('La agencia indicada no existe en este secad.');
    return a;
  }

  private async agenciaValida(tenant: string, id?: string | null): Promise<string | null> {
    if (!id) return null;
    return (await this.agenciaDe(tenant, id)).id;
  }

  private normalizarCodigo(codigo?: string): string {
    return (codigo ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  }

  /**
   * Siembra el catálogo base la primera vez que un secad lo consulta. Es
   * idempotente: si ya hay agencias no toca nada, así que un secad puede
   * renombrarlas o desactivarlas sin que vuelvan a aparecer.
   */
  async asegurarSeed(tenant: string): Promise<void> {
    if (!tenant) return;
    if (await this.agencias.count({ where: { tenant } })) return;

    const porCodigo = new Map<string, string>();
    for (const s of SEMILLA) {
      const a = await this.agencias.save(this.agencias.create({
        tenant, codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, activo: true,
      }));
      porCodigo.set(s.codigo, a.id);
      for (const [codigo, nombre] of s.canales) {
        await this.canales.save(this.canales.create({ tenant, agenciaId: a.id, codigo, nombre, activo: true }));
      }
    }
    if (!(await this.codigos.count({ where: { tenant } }))) {
      for (const [codigo, descripcion, prioridad, agencia] of SEMILLA_CODIGOS) {
        await this.codigos.save(this.codigos.create({
          tenant, codigo, descripcion, prioridad, agenciaSugeridaId: porCodigo.get(agencia) ?? null, activo: true,
        }));
      }
    }
  }
}
