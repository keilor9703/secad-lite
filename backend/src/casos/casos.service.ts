import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CasoEntity } from './caso.entity';
import { EventoCasoEntity, TipoEvento } from './evento.entity';
import { CANALES, EstadoCaso, ESTADOS } from './caso.model';
import { Rol } from '../usuarios/usuario.entity';
import { DespachoService } from '../despacho/despacho.service';

/** Contexto mínimo del actor (subconjunto del JWT) para auditoría y permisos. */
export interface Actor {
  sub: string;
  rol: Rol;
}
import { CrearCasoDto } from './dto/crear-caso.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';

/**
 * Casos persistidos en PostgreSQL. Todo consulta/escribe SIEMPRE acotado por
 * `tenant` (modelo pooled). Cada acción relevante queda registrada en la bitácora
 * de auditoría (casos_eventos) para reconstruir la línea de tiempo del caso.
 */
@Injectable()
export class CasosService implements OnModuleInit {
  constructor(
    @InjectRepository(CasoEntity)
    private readonly repo: Repository<CasoEntity>,
    @InjectRepository(EventoCasoEntity)
    private readonly eventos: Repository<EventoCasoEntity>,
    private readonly despacho: DespachoService,
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

  /** Línea de tiempo de un caso (valida antes que el caso pertenezca al tenant). */
  async listarAuditoria(tenant: string, casoId: string): Promise<EventoCasoEntity[]> {
    await this.obtener(tenant, casoId);
    return this.eventos.find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
  }

  async crear(tenant: string, dto: CrearCasoDto, usuario: string): Promise<CasoEntity> {
    if (!dto?.titulo?.trim()) throw new BadRequestException('El título es obligatorio.');
    if (!dto?.ciudadano?.trim()) throw new BadRequestException('El ciudadano es obligatorio.');
    if (!CANALES.includes(dto.canal)) throw new BadRequestException('Canal inválido.');

    const caso = await this.repo.save(
      this.repo.create({
        tenant,
        canal: dto.canal,
        titulo: dto.titulo.trim(),
        descripcion: dto.descripcion?.trim() ?? '',
        ciudadano: dto.ciudadano.trim(),
        telefono: dto.telefono?.trim() || null,
        agencia: dto.agencia?.trim() || 'Central',
        lat: typeof dto.lat === 'number' ? dto.lat : null,
        lng: typeof dto.lng === 'number' ? dto.lng : null,
        estado: 'nuevo',
        creadoPor: usuario,
      }),
    );
    await this.registrar(tenant, caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.`, usuario);
    return caso;
  }

  async cambiarEstado(tenant: string, id: string, dto: CambiarEstadoDto, actor: Actor): Promise<CasoEntity> {
    const caso = await this.obtener(tenant, id);
    if (!ESTADOS.includes(dto.estado)) throw new BadRequestException('Estado inválido.');
    if (dto.estado === 'derivado' && !dto.agencia?.trim()) {
      throw new BadRequestException('Para derivar se requiere la agencia destino.');
    }

    // Cerrar y reabrir son acciones reservadas a supervisor/admin.
    const privilegiado = actor.rol === 'supervisor' || actor.rol === 'admin';
    if (dto.estado === 'cerrado' && !privilegiado) {
      throw new ForbiddenException('Solo un supervisor o admin puede cerrar casos.');
    }
    if (caso.estado === 'cerrado' && dto.estado !== 'cerrado' && !privilegiado) {
      throw new ForbiddenException('Solo un supervisor o admin puede reabrir casos.');
    }

    const usuario = actor.sub;
    const anterior = caso.estado;
    const agenciaAnterior = caso.agencia;
    caso.estado = dto.estado;
    if (dto.estado === 'derivado') caso.agencia = dto.agencia!.trim();
    const guardado = await this.repo.save(caso);

    // Al cerrar, se liberan automáticamente los recursos aún comprometidos.
    if (dto.estado === 'cerrado' && anterior !== 'cerrado') {
      await this.despacho.liberarCaso(tenant, id, usuario);
    }

    if (dto.estado === 'derivado' && caso.agencia !== agenciaAnterior) {
      await this.registrar(
        tenant, id, 'derivacion',
        `Derivado de ${agenciaAnterior} a ${caso.agencia}.`, usuario, anterior, dto.estado,
      );
    } else {
      await this.registrar(
        tenant, id, 'estado',
        `Estado: ${this.label(anterior)} → ${this.label(dto.estado)}.`, usuario, anterior, dto.estado,
      );
    }
    return guardado;
  }

  async agregarNota(tenant: string, casoId: string, texto: string, usuario: string): Promise<EventoCasoEntity> {
    await this.obtener(tenant, casoId);
    const t = texto?.trim();
    if (!t) throw new BadRequestException('La nota no puede estar vacía.');
    if (t.length > 1000) throw new BadRequestException('La nota supera los 1000 caracteres.');
    return this.registrar(tenant, casoId, 'nota', t, usuario);
  }

  // ---------------------------------------------------------------------------
  private registrar(
    tenant: string, casoId: string, tipo: TipoEvento, descripcion: string,
    autor: string, estadoAnterior?: EstadoCaso, estadoNuevo?: EstadoCaso,
  ): Promise<EventoCasoEntity> {
    return this.eventos.save(
      this.eventos.create({ tenant, casoId, tipo, descripcion, autor, estadoAnterior, estadoNuevo }),
    );
  }

  private label(e: EstadoCaso): string {
    return { nuevo: 'Nuevo', en_gestion: 'En gestión', despachado: 'Despachado', derivado: 'Derivado', cerrado: 'Cerrado' }[e];
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
      const caso = await this.repo.save(this.repo.create({ ...b, tenant: 'demo', descripcion: '', creadoPor: 'seed' }));
      await this.registrar('demo', caso.id, 'creacion', `Caso recepcionado por ${caso.canal}.`, 'seed');
      if (b.estado === 'en_gestion') {
        await this.registrar('demo', caso.id, 'estado', 'Estado: Nuevo → En gestión.', 'seed', 'nuevo', 'en_gestion');
      }
    }
  }
}
