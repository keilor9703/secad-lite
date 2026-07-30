import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AsignacionEntity, EstadoAsignacion, ESTADOS_ASIGNACION, ESTADOS_ASIGNACION_ACTIVOS } from './asignacion.entity';
import { RecursoEntity } from './recurso.entity';
import { RecursosService } from './recursos.service';
import { CasoEntity } from '../casos/caso.entity';
import { EventoCasoEntity } from '../casos/evento.entity';

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
    @InjectRepository(CasoEntity) private readonly casos: Repository<CasoEntity>,
    @InjectRepository(EventoCasoEntity) private readonly eventos: Repository<EventoCasoEntity>,
    private readonly recursosSvc: RecursosService,
  ) {}

  listar(tenant: string, casoId: string): Promise<AsignacionEntity[]> {
    return this.asignaciones.find({ where: { tenant, casoId }, order: { creadoEn: 'ASC' } });
  }

  /** Despacha un recurso disponible al caso. */
  async asignar(tenant: string, casoId: string, recursoId: string, autor: string): Promise<AsignacionEntity> {
    const caso = await this.casos.findOne({ where: { tenant, id: casoId } });
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    if (caso.estado === 'cerrado') throw new BadRequestException('El caso está cerrado.');

    const recurso = await this.recursosSvc.obtener(tenant, recursoId);
    if (!recurso.activo || recurso.estado !== 'disponible') {
      throw new BadRequestException(`El recurso ${recurso.codigo} no está disponible.`);
    }

    const asignacion = await this.asignaciones.save(
      this.asignaciones.create({
        tenant, casoId, recursoId,
        recursoCodigo: recurso.codigo, recursoNombre: recurso.nombre,
        estado: 'asignado', asignadoPor: autor,
      }),
    );

    await this.recursosSvc.setEstado(recurso, 'asignado');

    // El caso pasa a "despachado" en cuanto tiene recursos en atención.
    if (caso.estado === 'nuevo' || caso.estado === 'en_gestion') {
      caso.estado = 'despachado';
      await this.casos.save(caso);
    }

    await this.auditar(tenant, casoId, `Despachado ${recurso.codigo} — ${recurso.nombre}.`, autor);
    return asignacion;
  }

  /** Avanza (o cierra) el despacho de un recurso. */
  async cambiarEstado(tenant: string, asignacionId: string, estado: EstadoAsignacion, autor: string, motivo?: string): Promise<AsignacionEntity> {
    if (!ESTADOS_ASIGNACION.includes(estado)) throw new BadRequestException('Estado de asignación inválido.');
    const a = await this.asignaciones.findOne({ where: { tenant, id: asignacionId } });
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
    await this.asignaciones.save(a);

    // Sincroniza el estado del recurso.
    const recurso = await this.recursosSvc.obtener(tenant, a.recursoId);
    if (estado === 'en_ruta' || estado === 'en_sitio') {
      await this.recursosSvc.setEstado(recurso, estado);
    } else {
      // finalizada / cancelada → el recurso vuelve a estar disponible.
      await this.recursosSvc.setEstado(recurso, 'disponible');
    }

    const detalle = estado === 'cancelada' ? ` (${a.motivo})` : '';
    await this.auditar(tenant, a.casoId, `Recurso ${a.recursoCodigo}: ${LABEL[anterior]} → ${LABEL[estado]}.${detalle}`, autor);
    return a;
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
    const activas = await this.activasDe(tenant, casoId);
    for (const a of activas) {
      a.estado = 'finalizada';
      await this.asignaciones.save(a);
      const recurso = await this.recursosSvc.obtener(tenant, a.recursoId).catch(() => null);
      if (recurso) await this.recursosSvc.setEstado(recurso, 'disponible');
      await this.auditar(tenant, casoId, `Caso cerrado — recurso ${a.recursoCodigo} liberado automáticamente.`, autor);
    }
  }

  /**
   * Sugiere recursos disponibles ordenados por cercanía al caso: distancia
   * lineal (Haversine) + ETA estimado a 40 km/h. Si el caso o el recurso no
   * tienen coordenadas, la distancia queda en null y esos recursos van al final.
   */
  async recursosSugeridos(tenant: string, casoId: string): Promise<RecursoSugerido[]> {
    const caso = await this.casos.findOne({ where: { tenant, id: casoId } });
    if (!caso) throw new NotFoundException('Caso no encontrado.');
    const disponibles = await this.recursosSvc.disponibles(tenant);
    const conCoords = typeof caso.lat === 'number' && typeof caso.lng === 'number';

    const sugeridos: RecursoSugerido[] = disponibles.map((recurso) => {
      if (!conCoords || typeof recurso.lat !== 'number' || typeof recurso.lng !== 'number') {
        return { recurso, distanciaKm: null, etaMin: null };
      }
      const distanciaKm = haversineKm(caso.lat!, caso.lng!, recurso.lat, recurso.lng);
      const etaMin = Math.max(1, Math.round((distanciaKm / 40) * 60));
      return { recurso, distanciaKm: Math.round(distanciaKm * 100) / 100, etaMin };
    });

    sugeridos.sort((a, b) => {
      if (a.distanciaKm === null) return b.distanciaKm === null ? 0 : 1;
      if (b.distanciaKm === null) return -1;
      return a.distanciaKm - b.distanciaKm;
    });
    return sugeridos;
  }

  private auditar(tenant: string, casoId: string, descripcion: string, autor: string): Promise<EventoCasoEntity> {
    return this.eventos.save(this.eventos.create({ tenant, casoId, tipo: 'despacho', descripcion, autor }));
  }
}

/** Recurso disponible con su cercanía estimada al caso. */
export interface RecursoSugerido {
  recurso: RecursoEntity;
  distanciaKm: number | null;
  etaMin: number | null;
}

/** Distancia en kilómetros entre dos puntos (fórmula de Haversine). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // radio terrestre (km)
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
