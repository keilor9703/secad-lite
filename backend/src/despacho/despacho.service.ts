import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AsignacionEntity, EstadoAsignacion, ESTADOS_ASIGNACION, ESTADOS_ASIGNACION_ACTIVOS } from './asignacion.entity';
import { RecursoEntity } from './recurso.entity';
import { CasoEntity } from '../casos/caso.entity';
import { EventoCasoEntity } from '../casos/evento.entity';
import { TenantRlsService } from '../common/tenant-rls.service';

/** Ciclo de vida del despacho de un recurso. */
const SIGUIENTES: Record<EstadoAsignacion, EstadoAsignacion[]> = {
  asignado: ['en_ruta', 'en_sitio', 'cancelada'],
  en_ruta: ['en_sitio', 'cancelada'],
  en_sitio: ['finalizada', 'cancelada'],
  finalizada: [],
  cancelada: [],
};

const LABEL: Record<EstadoAsignacion, string> = {
  asignado: 'Asignado', en_ruta: 'En ruta', en_sitio: 'En sitio', finalizada: 'Finalizada', cancelada: 'Cancelada',
};

/**
 * Despacho: asigna recursos a un caso y hace avanzar su ciclo (asignado → en
 * ruta → en sitio → finalizada/cancelada), manteniendo sincronizado el estado
 * del recurso y del caso, y dejando traza en la bitácora. Todo por tenant.
 */
@Injectable()
export class DespachoService {
  constructor(
    @InjectRepository(AsignacionEntity) private readonly asignaciones: Repository<AsignacionEntity>,
    @InjectRepository(EventoCasoEntity) private readonly eventos: Repository<EventoCasoEntity>,
    private readonly rls: TenantRlsService,
  ) {}

  listar(tenant: string, casoId: string): Promise<AsignacionEntity[]> {
    return this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(AsignacionEntity).find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } }),
    );
  }

  /**
   * Despacha un recurso disponible al caso.
   *
   * Todo dentro de UNA transacción, con el recurso bloqueado (SELECT … FOR
   * UPDATE): dos despachadores que elijan la misma unidad al tiempo ya no
   * "ganan" ambos — el segundo espera el bloqueo, encuentra el recurso ya
   * asignado y recibe el error de no disponible. Y si algo falla a mitad,
   * no queda ni la asignación sin recurso ni el recurso sin asignación.
   */
  async asignar(tenant: string, casoId: string, recursoId: string, autor: string): Promise<AsignacionEntity> {
    return this.rls.conTenant(tenant, async (em) => {
      const caso = await em.findOne(CasoEntity, { where: { tenant, id: casoId } });
      if (!caso) throw new NotFoundException('Caso no encontrado.');
      if (caso.estado === 'cerrado') throw new BadRequestException('El caso está cerrado.');

      const recurso = await em.findOne(RecursoEntity, {
        where: { tenant, id: recursoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!recurso) throw new NotFoundException('Recurso no encontrado.');
      if (!recurso.activo || recurso.estado !== 'disponible') {
        throw new BadRequestException(`El recurso ${recurso.codigo} no está disponible.`);
      }

      const asignacion = await em.save(
        em.create(AsignacionEntity, {
          tenant, casoId, recursoId,
          recursoCodigo: recurso.codigo, recursoNombre: recurso.nombre,
          estado: 'asignado', asignadoPor: autor,
        }),
      );

      recurso.estado = 'asignado';
      await em.save(recurso);

      // El caso pasa a "despachado" en cuanto tiene recursos en atención.
      if (caso.estado === 'nuevo' || caso.estado === 'en_gestion') {
        caso.estado = 'despachado';
        await em.save(caso);
      }

      await this.auditar(tenant, casoId, `Despachado ${recurso.codigo} — ${recurso.nombre}.`, autor, em);
      return asignacion;
    });
  }

  /**
   * Avanza (o cierra) el despacho de un recurso. Transaccional, con la
   * asignación bloqueada: dos clics simultáneos sobre el mismo despacho ya no
   * aplican dos transiciones — el segundo espera y falla la validación.
   */
  async cambiarEstado(tenant: string, asignacionId: string, estado: EstadoAsignacion, autor: string, motivo?: string): Promise<AsignacionEntity> {
    if (!ESTADOS_ASIGNACION.includes(estado)) throw new BadRequestException('Estado de asignación inválido.');
    return this.rls.conTenant(tenant, async (em) => {
      const a = await em.findOne(AsignacionEntity, {
        where: { tenant, id: asignacionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!a) throw new NotFoundException('Asignación no encontrada.');
      if (!ESTADOS_ASIGNACION_ACTIVOS.includes(a.estado)) {
        throw new BadRequestException('La asignación ya está cerrada.');
      }
      if (!SIGUIENTES[a.estado].includes(estado)) {
        throw new BadRequestException(`Transición no permitida: ${LABEL[a.estado]} → ${LABEL[estado]}.`);
      }
      if (estado === 'cancelada' && !motivo?.trim()) {
        throw new BadRequestException('Indique el motivo de la cancelación.');
      }

      const anterior = a.estado;
      a.estado = estado;
      if (motivo?.trim()) a.motivo = motivo.trim();
      await em.save(a);

      // Sincroniza el estado del recurso (bloqueado también, por si otro
      // despacho lo está tocando en paralelo).
      const recurso = await em.findOne(RecursoEntity, {
        where: { tenant, id: a.recursoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (recurso) {
        recurso.estado = estado === 'en_ruta' || estado === 'en_sitio' ? estado : 'disponible';
        await em.save(recurso);
      }

      const detalle = estado === 'cancelada' ? ` (${a.motivo})` : '';
      await this.auditar(tenant, a.casoId, `Recurso ${a.recursoCodigo}: ${LABEL[anterior]} → ${LABEL[estado]}.${detalle}`, autor, em);

      // Sin recursos activos el caso ya no está "con recursos": vuelve a gestión,
      // para que el tablero lo muestre donde corresponde sin intervención manual.
      const activas = await em.find(AsignacionEntity, { where: { tenant, casoId: a.casoId } });
      if (!activas.some((x) => ESTADOS_ASIGNACION_ACTIVOS.includes(x.estado))) {
        const caso = await em.findOne(CasoEntity, { where: { tenant, id: a.casoId } });
        if (caso && caso.estado === 'despachado') {
          caso.estado = 'en_gestion';
          await em.save(caso);
          await this.auditar(tenant, a.casoId, 'Sin recursos en atención: el caso vuelve a gestión.', autor, em);
        }
      }
      return a;
    });
  }

  /** Recursos activos comprometidos con un caso (para saber si se puede cerrar). */
  async activasDe(tenant: string, casoId: string): Promise<AsignacionEntity[]> {
    const todas = await this.listar(tenant, casoId);
    return todas.filter((x) => ESTADOS_ASIGNACION_ACTIVOS.includes(x.estado));
  }

  /**
   * Libera automáticamente los recursos aún comprometidos con un caso: finaliza
   * sus asignaciones activas y devuelve cada recurso a 'disponible'. Se invoca al
   * cerrar el caso, dejando traza por cada recurso liberado.
   */
  async liberarCaso(tenant: string, casoId: string, autor: string): Promise<void> {
    await this.rls.conTenant(tenant, async (em) => {
      const todas = await em.find(AsignacionEntity, { where: { tenant, casoId } });
      for (const a of todas.filter((x) => ESTADOS_ASIGNACION_ACTIVOS.includes(x.estado))) {
        a.estado = 'finalizada';
        await em.save(a);
        const recurso = await em.findOne(RecursoEntity, {
          where: { tenant, id: a.recursoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (recurso) {
          recurso.estado = 'disponible';
          await em.save(recurso);
        }
        await this.auditar(tenant, casoId, `Caso cerrado — recurso ${a.recursoCodigo} liberado automáticamente.`, autor, em);
      }
    });
  }

  /** Bitácora del despacho; con `em` participa en la transacción en curso. */
  private auditar(tenant: string, casoId: string, descripcion: string, autor: string, em?: EntityManager): Promise<EventoCasoEntity> {
    const repo = em ? em.getRepository(EventoCasoEntity) : this.eventos;
    return repo.save(repo.create({ tenant, casoId, tipo: 'despacho', descripcion, autor }));
  }
}
