import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { Subject } from 'rxjs';
import { LlamadaEntity } from './llamada.entity';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { TenantRlsService } from '../common/tenant-rls.service';

export interface WebhookLlamadaDto {
  /** 'entrante' cuando timbra; 'colgada' cuando termina antes/después de atender. */
  evento: 'entrante' | 'colgada';
  callId?: string;
  numero?: string;
  numeroDestino?: string;
  /**
   * Extensión a la que el ACD de la central ya decidió dirigir la llamada.
   * Es opcional a propósito: una planta sin colas ACD puede seguir usando la
   * integración tal cual, sin mandar este campo, y la llamada se anuncia a
   * todo el que esté atendiendo el tenant, como antes de tener este mapeo.
   */
  extension?: string;
}

/** Quién actúa: lo que necesita este servicio para decidir alcance y permisos. */
export interface ActorPbx {
  username: string;
  /** Con esto ve y puede atender cualquier llamada, esté o no dirigida a él. */
  supervisor: boolean;
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
 *
 * El enrutamiento a un operador específico (ACD) es responsabilidad de la
 * central, no de FALCON CAD: aquí solo se traduce la extensión que la central
 * ya decidió al username del funcionario dueño de esa extensión, y con eso se
 * dirige el aviso en vivo (y se filtra la cola) a esa sola sesión.
 */
@Injectable()
export class PbxService {
  /** Flujo de cambios de la cola; el gateway lo reenvía por WebSocket. */
  readonly eventos$ = new Subject<LlamadaEvento>();

  constructor(
    private readonly casosSvc: CasosService,
    private readonly tenants: TenantsService,
    private readonly usuarios: UsuariosService,
    private readonly rls: TenantRlsService,
  ) {}

  /** Procesa un evento de la PBX autenticado por API key. */
  async webhook(apiKey: string, dto: WebhookLlamadaDto): Promise<LlamadaEntity> {
    const tenant = await this.tenants.porApiKey(apiKey);
    if (!tenant) throw new UnauthorizedException('API key inválida.');
    // Bloqueado, suscripción suspendida/vencida, o sin la integración pbx
    // contratada: nada de esto lo revisa el guard global porque esta ruta es
    // pública (la llama la central, sin sesión de usuario).
    this.tenants.asegurarVigente(tenant, 'pbx');

    // La central no manda X-Tenant-Id ni sesión: recién aquí se supo el
    // tenant (por la API key), así que `app.tenant` (RLS) se fija DENTRO de
    // esta transacción, no antes.
    return this.rls.conTenant(tenant.codigo, async (manager) => {
      const llamadas = manager.getRepository(LlamadaEntity);

      if (dto?.evento === 'entrante') {
        const numero = dto.numero?.trim();
        if (!numero) throw new BadRequestException('El número del llamante es obligatorio.');

        // Idempotencia: si la central reintenta el mismo evento (mismo callId
        // aún timbrando), se devuelve la llamada ya registrada en vez de
        // duplicarla en la cola.
        if (dto.callId?.trim()) {
          const repetida = await llamadas.findOne({
            where: { tenant: tenant.codigo, callId: dto.callId.trim(), estado: 'sonando' },
          });
          if (repetida) return repetida;
        }

        // Si la central ya enrutó (ACD), se resuelve la extensión al funcionario
        // dueño; sin extensión, o si no hay match, queda sin destinatario y se
        // anuncia a todo el tenant — la integración sigue sirviendo igual.
        const extension = dto.extension?.trim() || null;
        const destinatario = extension
          ? (await this.usuarios.buscarPorExtension(tenant.codigo, extension))?.username ?? null
          : null;

        const llamada = await llamadas.save(
          llamadas.create({
            tenant: tenant.codigo,
            callId: dto.callId?.trim() || null,
            numero,
            numeroDestino: dto.numeroDestino?.trim() || null,
            extension,
            destinatario,
            estado: 'sonando',
          }),
        );
        this.eventos$.next({ tenant: tenant.codigo, tipo: 'entrante', llamada });
        return llamada;
      }

      if (dto?.evento === 'colgada') {
        const llamada = await this.ubicar(manager, tenant.codigo, dto.callId, dto.numero);
        if (!llamada) throw new NotFoundException('Llamada no encontrada.');
        if (llamada.estado === 'sonando') llamada.estado = 'perdida';
        else if (llamada.estado === 'atendida') llamada.estado = 'finalizada';
        const guardada = await llamadas.save(llamada);
        this.eventos$.next({ tenant: tenant.codigo, tipo: 'cambio', llamada: guardada });
        return guardada;
      }

      throw new BadRequestException('Evento de PBX no reconocido.');
    });
  }

  /**
   * Cola de llamadas del tenant. Una llamada SONANDO dirigida por el ACD a
   * otro operador no aparece: ya está siendo anunciada solo a esa sesión, y
   * mostrarla aquí invitaría a un tercero a arrebatarla. Un supervisor
   * (casos.ver_todos) sí ve la cola completa, para poder auxiliar.
   * Las que ya se atendieron o perdieron quedan visibles siempre: son
   * historial, no una llamada disputable.
   */
  async listar(tenant: string, actor: ActorPbx): Promise<LlamadaEntity[]> {
    const todas = await this.rls.conTenant(tenant, (manager) =>
      manager.getRepository(LlamadaEntity).find({ where: { tenant }, order: { creadoEn: 'DESC' }, take: 50 }),
    );
    if (actor.supervisor) return todas;
    return todas.filter((l) => l.estado !== 'sonando' || !l.destinatario || l.destinatario === actor.username);
  }

  /**
   * El operador atiende una llamada: crea un caso (canal 'llamada') o lo enlaza
   * a un caso abierto del mismo número, y marca la llamada como atendida.
   */
  async atender(tenant: string, llamadaId: string, actor: ActorPbx): Promise<{ llamada: LlamadaEntity; casoId: string }> {
    const { llamada: llamadaLeida, abiertoId } = await this.rls.conTenant(tenant, async (manager) => {
      const llamada = await manager.getRepository(LlamadaEntity).findOne({ where: { tenant, id: llamadaId } });
      if (!llamada) throw new NotFoundException('Llamada no encontrada.');
      // ¿Hay un caso abierto del mismo número? Se enlaza en vez de duplicar.
      const abierto = llamada.estado === 'sonando'
        ? await manager.getRepository(CasoEntity).findOne({
            where: { tenant, telefono: llamada.numero, estado: Not('cerrado') },
            order: { creadoEn: 'DESC' },
          })
        : null;
      return { llamada, abiertoId: abierto?.id ?? null };
    });
    const llamada = llamadaLeida;
    if (llamada.estado === 'atendida' && llamada.casoId) {
      return { llamada, casoId: llamada.casoId };
    }
    if (llamada.estado !== 'sonando') {
      throw new BadRequestException('La llamada ya no está en cola.');
    }
    // El ACD ya la dirigió a otro operador: solo él (o un supervisor) la atiende.
    if (llamada.destinatario && llamada.destinatario !== actor.username && !actor.supervisor) {
      throw new ForbiddenException('Esta llamada fue dirigida a otro operador por la central.');
    }

    let casoId: string;
    if (abiertoId) {
      casoId = abiertoId;
      await this.casosSvc.agregarNota(tenant, casoId, `Llamada telefónica atendida (${llamada.numero}).`, actor.username);
    } else {
      const caso = await this.casosSvc.crear(
        tenant,
        {
          canal: 'llamada',
          titulo: `Llamada entrante ${llamada.numero}`,
          ciudadano: `Llamante ${llamada.numero}`,
          telefono: llamada.numero,
        },
        actor.username,
      );
      casoId = caso.id;
    }

    llamada.estado = 'atendida';
    llamada.casoId = casoId;
    llamada.atendidaPor = actor.username;
    llamada.atendidaEn = new Date();
    const guardada = await this.rls.conTenant(tenant, (manager) => manager.getRepository(LlamadaEntity).save(llamada));
    this.eventos$.next({ tenant, tipo: 'cambio', llamada: guardada });
    return { llamada: guardada, casoId };
  }

  /**
   * El operador toma la llamada para trabajarla en el formulario de
   * Recepción, SIN crear todavía ningún caso: se reutiliza `destinatario`
   * (el mismo campo que usa el enrutamiento por ACD) para que desaparezca
   * de la cola de los demás operadores — no la puede tomar dos veces —
   * mientras la completa. Solo se marca "atendida" y se enlaza al caso real
   * cuando ese caso se guarda (ver `vincular`), para no perder la llamada
   * en un caso vacío si el operador nunca llega a guardar.
   */
  async reclamar(tenant: string, llamadaId: string, actor: ActorPbx): Promise<LlamadaEntity> {
    const guardada = await this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(LlamadaEntity);
      const llamada = await repo.findOne({ where: { tenant, id: llamadaId } });
      if (!llamada) throw new NotFoundException('Llamada no encontrada.');
      if (llamada.estado !== 'sonando') throw new BadRequestException('La llamada ya no está en cola.');
      if (llamada.destinatario && llamada.destinatario !== actor.username && !actor.supervisor) {
        throw new ForbiddenException('Esta llamada fue dirigida a otro operador por la central.');
      }
      llamada.destinatario = actor.username;
      return repo.save(llamada);
    });
    this.eventos$.next({ tenant, tipo: 'cambio', llamada: guardada });
    return guardada;
  }

  /**
   * El operador suelta una llamada que tomó pero no llegó a guardar como
   * caso (canceló el formulario, tomó otra por error): vuelve a la cola
   * compartida. Si la central ya la había dirigido a este operador por ACD
   * (tiene `extension`), soltar no la libera a los demás — sigue siendo
   * suya según la central, tomarla de nuevo es lo correcto.
   */
  async soltar(tenant: string, llamadaId: string, actor: ActorPbx): Promise<LlamadaEntity> {
    const guardada = await this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(LlamadaEntity);
      const llamada = await repo.findOne({ where: { tenant, id: llamadaId } });
      if (!llamada) throw new NotFoundException('Llamada no encontrada.');
      if (llamada.estado !== 'sonando' || llamada.destinatario !== actor.username) return llamada;
      if (!llamada.extension) llamada.destinatario = null;
      return repo.save(llamada);
    });
    this.eventos$.next({ tenant, tipo: 'cambio', llamada: guardada });
    return guardada;
  }

  /**
   * Cierra el flujo "tomar → completar el formulario → guardar": enlaza la
   * llamada con el caso que acaba de crear Recepción y la marca atendida.
   * No crea el caso —eso ya lo hizo el formulario, con todo lo que el
   * operador alcanzó a diligenciar mientras hablaba— solo deja constancia
   * de cuál llamada lo originó.
   */
  async vincular(tenant: string, llamadaId: string, casoId: string, actor: ActorPbx): Promise<LlamadaEntity> {
    const guardada = await this.rls.conTenant(tenant, async (manager) => {
      const repo = manager.getRepository(LlamadaEntity);
      const llamada = await repo.findOne({ where: { tenant, id: llamadaId } });
      if (!llamada) throw new NotFoundException('Llamada no encontrada.');
      if (llamada.destinatario && llamada.destinatario !== actor.username && !actor.supervisor) {
        throw new ForbiddenException('Esta llamada fue tomada por otro operador.');
      }
      // Idempotente si ya quedó enlazada a ese mismo caso (doble clic, reintento).
      if (llamada.estado === 'atendida' && llamada.casoId === casoId) return llamada;
      // Solo se enlaza una llamada aún en curso: una perdida o finalizada no
      // puede "resucitar" como atendida.
      if (llamada.estado !== 'sonando') throw new BadRequestException('La llamada ya no está en cola.');
      // El caso debe existir en este tenant: sin esto quedaba cualquier string
      // como enlace y el historial llevaba a un caso inexistente. (El catch
      // cubre un id que ni siquiera es un UUID: para Postgres es un error de
      // sintaxis, para el cliente es el mismo "no existe".)
      const caso = await manager.getRepository(CasoEntity).findOne({ where: { tenant, id: casoId ?? '' } }).catch(() => null);
      if (!caso) throw new BadRequestException('El caso a enlazar no existe.');
      llamada.estado = 'atendida';
      llamada.casoId = caso.id;
      llamada.atendidaPor = actor.username;
      llamada.atendidaEn = new Date();
      return repo.save(llamada);
    });
    this.eventos$.next({ tenant, tipo: 'cambio', llamada: guardada });
    return guardada;
  }

  private ubicar(manager: EntityManager, tenant: string, callId?: string, numero?: string): Promise<LlamadaEntity | null> {
    const repo = manager.getRepository(LlamadaEntity);
    if (callId?.trim()) {
      return repo.findOne({ where: { tenant, callId: callId.trim() }, order: { creadoEn: 'DESC' } });
    }
    if (numero?.trim()) {
      return repo.findOne({ where: { tenant, numero: numero.trim(), estado: 'sonando' }, order: { creadoEn: 'DESC' } });
    }
    return Promise.resolve(null);
  }
}
