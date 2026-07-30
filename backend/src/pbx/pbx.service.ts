import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Subject } from 'rxjs';
import { LlamadaEntity } from './llamada.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';

export interface WebhookLlamadaDto {
  /** 'entrante' cuando timbra; 'colgada' cuando termina antes/después de atender. */
  evento: 'entrante' | 'colgada';
  callId?: string;
  numero?: string;
  numeroDestino?: string;
}

/** Cambio en la cola de llamadas, para empujar por WebSocket al operador. */
export interface LlamadaEvento {
  tenant: string;
  tipo: 'entrante' | 'cambio';
  llamada: LlamadaEntity;
}

/**
 * Integración con la planta telefónica (PBX). La central llama al webhook
 * (autenticado por API key del tenant) al timbrar/colgar; las llamadas entran a
 * una cola en vivo y el operador las "atiende", creando o enlazando un caso.
 */
@Injectable()
export class PbxService {
  /** Flujo de cambios de la cola; el gateway lo reenvía por WebSocket. */
  readonly eventos$ = new Subject<LlamadaEvento>();

  constructor(
    @InjectRepository(LlamadaEntity) private readonly llamadas: Repository<LlamadaEntity>,
    @InjectRepository(CasoEntity) private readonly casos: Repository<CasoEntity>,
    private readonly casosSvc: CasosService,
    private readonly tenants: TenantsService,
  ) {}

  /** Procesa un evento de la PBX autenticado por API key. */
  async webhook(apiKey: string, dto: WebhookLlamadaDto): Promise<LlamadaEntity> {
    const tenant = await this.tenants.porApiKey(apiKey);
    if (!tenant) throw new UnauthorizedException('API key inválida.');
    if (!tenant.activo) throw new UnauthorizedException('Tenant inactivo.');

    if (dto?.evento === 'entrante') {
      const numero = dto.numero?.trim();
      if (!numero) throw new BadRequestException('El número del llamante es obligatorio.');
      const llamada = await this.llamadas.save(
        this.llamadas.create({
          tenant: tenant.codigo,
          callId: dto.callId?.trim() || null,
          numero,
          numeroDestino: dto.numeroDestino?.trim() || null,
          estado: 'sonando',
        }),
      );
      this.eventos$.next({ tenant: tenant.codigo, tipo: 'entrante', llamada });
      return llamada;
    }

    if (dto?.evento === 'colgada') {
      const llamada = await this.ubicar(tenant.codigo, dto.callId, dto.numero);
      if (!llamada) throw new NotFoundException('Llamada no encontrada.');
      if (llamada.estado === 'sonando') llamada.estado = 'perdida';
      else if (llamada.estado === 'atendida') llamada.estado = 'finalizada';
      const guardada = await this.llamadas.save(llamada);
      this.eventos$.next({ tenant: tenant.codigo, tipo: 'cambio', llamada: guardada });
      return guardada;
    }

    throw new BadRequestException('Evento de PBX no reconocido.');
  }

  /** Cola de llamadas del tenant (las que timbran primero, luego recientes). */
  async listar(tenant: string): Promise<LlamadaEntity[]> {
    return this.llamadas.find({ where: { tenant }, order: { creadoEn: 'DESC' }, take: 50 });
  }

  /**
   * El operador atiende una llamada: crea un caso (canal 'llamada') o lo enlaza
   * a un caso abierto del mismo número, y marca la llamada como atendida.
   */
  async atender(tenant: string, llamadaId: string, operador: string): Promise<{ llamada: LlamadaEntity; casoId: string }> {
    const llamada = await this.llamadas.findOne({ where: { tenant, id: llamadaId } });
    if (!llamada) throw new NotFoundException('Llamada no encontrada.');
    if (llamada.estado === 'atendida' && llamada.casoId) {
      return { llamada, casoId: llamada.casoId };
    }
    if (llamada.estado !== 'sonando') {
      throw new BadRequestException('La llamada ya no está en cola.');
    }

    // ¿Hay un caso abierto del mismo número? Se enlaza en vez de duplicar.
    const abierto = await this.casos.findOne({
      where: { tenant, telefono: llamada.numero, estado: Not('cerrado') },
      order: { creadoEn: 'DESC' },
    });

    let casoId: string;
    if (abierto) {
      casoId = abierto.id;
      await this.casosSvc.agregarNota(tenant, casoId, `Llamada telefónica atendida (${llamada.numero}).`, operador);
    } else {
      const caso = await this.casosSvc.crear(
        tenant,
        {
          canal: 'llamada',
          titulo: `Llamada entrante ${llamada.numero}`,
          ciudadano: `Llamante ${llamada.numero}`,
          telefono: llamada.numero,
        },
        operador,
      );
      casoId = caso.id;
    }

    llamada.estado = 'atendida';
    llamada.casoId = casoId;
    llamada.atendidaPor = operador;
    const guardada = await this.llamadas.save(llamada);
    this.eventos$.next({ tenant, tipo: 'cambio', llamada: guardada });
    return { llamada: guardada, casoId };
  }

  private ubicar(tenant: string, callId?: string, numero?: string): Promise<LlamadaEntity | null> {
    if (callId?.trim()) {
      return this.llamadas.findOne({ where: { tenant, callId: callId.trim() }, order: { creadoEn: 'DESC' } });
    }
    if (numero?.trim()) {
      return this.llamadas.findOne({ where: { tenant, numero: numero.trim(), estado: 'sonando' }, order: { creadoEn: 'DESC' } });
    }
    return Promise.resolve(null);
  }
}
