import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { EntityManager, Not } from 'typeorm';
import { Subject } from 'rxjs';
import { LlamadaEntity, ORIGENES_LLAMADA, OrigenLlamada } from './llamada.entity';
import { Canal } from '../casos/caso.model';
import { CasoEntity } from '../casos/caso.entity';
import { CasosService } from '../casos/casos.service';
import { TenantEntity } from '../tenants/tenant.entity';
import { UsuariosService } from '../usuarios/usuarios.service';
import { TenantRlsService } from '../common/tenant-rls.service';

/**
 * Antes esto era una `interface`, no una `class` — y el `ValidationPipe`
 * global solo valida/transforma contra un tipo con decoradores reales; una
 * interfaz se borra en tiempo de ejecución y el pipe la trata como `Object`,
 * así que el body pasaba TAL CUAL, sin validar nada. Un JSON mal formado (o
 * un `Content-Type` que no fuera `application/json`, el error más común al
 * probar desde Postman) llegaba como `undefined`/`{}` y el único aviso era
 * "Evento de PBX no reconocido" — cierto, pero no decía POR QUÉ. Con la
 * clase + los decoradores, el `ValidationPipe` ahora sí valida cada campo y
 * responde 400 con el campo exacto que falta o está mal, antes de llegar
 * siquiera al servicio.
 */
export class WebhookLlamadaDto {
  /** 'entrante' cuando timbra; 'colgada' cuando termina antes/después de atender. */
  @IsIn(['entrante', 'colgada'], { message: 'evento debe ser "entrante" o "colgada".' })
  evento!: 'entrante' | 'colgada';

  @IsOptional() @IsString() @MaxLength(120)
  callId?: string;

  /**
   * Obligatorio solo en 'entrante': en 'colgada' la llamada ya existe y se
   * ubica por callId/número. Sin @MaxLength aparte: un solo mensaje claro
   * (el largo real ya lo limita la columna de la base).
   */
  @ValidateIf((o: WebhookLlamadaDto) => o.evento === 'entrante')
  @IsString({ message: 'numero es obligatorio cuando evento es "entrante".' })
  numero?: string;

  @IsOptional() @IsString() @MaxLength(40)
  numeroDestino?: string;

  /**
   * Extensión a la que el ACD de la central ya decidió dirigir la llamada.
   * Es opcional a propósito: una planta sin colas ACD puede seguir usando la
   * integración tal cual, sin mandar este campo, y la llamada se anuncia a
   * todo el que esté atendiendo el tenant, como antes de tener este mapeo.
   */
  @IsOptional() @IsString() @MaxLength(20)
  extension?: string;

  /**
   * El agente/usuario que contestó, tal como lo identifica la central —no
   * necesariamente el username de FALCON (para eso ya existe `atendidaPor`,
   * que es quien la atendió DESDE la app). Este es el dato que reporta la
   * PBX; se guarda tal cual llega, útil incluso si no calza con ningún
   * usuario de FALCON.
   */
  @IsOptional() @IsString() @MaxLength(120)
  agente?: string;

  /**
   * Fecha y hora del evento, reportadas por la central en ISO 8601 —
   * idealmente CON zona horaria (ej. "2026-09-28T14:36:26-05:00"; también
   * vale terminar en "Z" para UTC). Se guarda tal cual, sin usarse para nada
   * más — FALCON ya sella su propio instante de recepción; esto es solo el
   * dato de la central, por si hace falta cruzarlo con sus propios
   * registros. Un formato que no sea una fecha ISO válida en absoluto (por
   * ejemplo "MMDDAA" + hora aparte) se rechaza con 400; el validador SÍ
   * acepta una fecha sin zona horaria, pero en ese caso queda ambiguo a qué
   * instante real corresponde — pídale a la central que siempre la incluya.
   */
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'fechaHora debe venir en formato ISO 8601, ej. "2026-09-28T14:36:26-05:00".' })
  fechaHora?: string;

  /**
   * Por dónde entra este contacto — la PBX es la misma central para los
   * tres, así que este campo (no un webhook distinto) es lo que le dice a
   * FALCON de cuál se trata. Sin mandarlo, se asume `"telefono"` (el
   * comportamiento de siempre, retrocompatible con centrales que todavía no
   * mandan este campo). Fija automáticamente el "Medio de comunicación" del
   * caso — el operador no tiene que elegirlo a mano.
   */
  @IsOptional() @IsIn(ORIGENES_LLAMADA, { message: `origen debe ser uno de: ${ORIGENES_LLAMADA.join(', ')}.` })
  origen?: OrigenLlamada;
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

  /**
   * A qué `canal` de caso corresponde cada origen — es lo que fija solo el
   * "Medio de comunicación" al crear el caso desde `atender()`, sin que el
   * operador tenga que elegirlo a mano.
   */
  private static readonly CANAL_DE_ORIGEN: Record<OrigenLlamada, Canal> = {
    telefono: 'llamada',
    whatsapp_chat: 'whatsapp',
    whatsapp_llamada: 'whatsapp_llamada',
  };

  /** Texto del caso que se crea al atender, según el origen. */
  private static readonly ETIQUETA_ORIGEN: Record<OrigenLlamada, { titulo: string; ciudadano: string; nota: string }> = {
    telefono: { titulo: 'Llamada entrante', ciudadano: 'Llamante', nota: 'Llamada telefónica atendida' },
    whatsapp_chat: { titulo: 'Chat de WhatsApp', ciudadano: 'Contacto WhatsApp', nota: 'Chat de WhatsApp atendido' },
    whatsapp_llamada: { titulo: 'Llamada de WhatsApp', ciudadano: 'Llamante WhatsApp', nota: 'Llamada de WhatsApp atendida' },
  };

  /**
   * Deja el identificador del llamante como un abonado marcable.
   *
   * Las pasarelas de WhatsApp no manejan "números": manejan JID
   * (`573175882321@s.whatsapp.net`, `…@c.us`). Si la central los reenvía tal
   * cual, eso es lo que FALCON guarda y lo que el operador ve en el campo
   * Abonado — un identificador que no se puede marcar ni cruzar contra los
   * casos del mismo número. Lo mismo pasa con un número "bonito" de la central
   * (`+57 317 588 2321`): se ve bien y no calza con nada.
   *
   * Se recorta el sufijo del JID y se quitan los adornos; el `+` inicial se
   * conserva porque sí es parte del número. No se toca el indicativo: `57…` y
   * `3…` son las dos formas legítimas de escribirlo aquí, y adivinar cuál
   * quiso decir la central sería inventar.
   *
   * El valor crudo no se pierde: el body entero de cada petición queda en
   * `pbx_webhook_log`.
   */
  static normalizarNumero(crudo: string): string {
    const sinJid = crudo.split('@')[0];
    const limpio = sinJid.replace(/[^\d+]/g, '');
    // Un `+` solo vale al principio; si queda en medio es ruido.
    const normalizado = limpio.startsWith('+') ? '+' + limpio.slice(1).replace(/\+/g, '')
                                               : limpio.replace(/\+/g, '');
    // Si al limpiar no queda nada marcable, se devuelve lo que llegó: es
    // preferible que el operador vea un identificador raro a que vea vacío.
    return normalizado || crudo.trim();
  }

  constructor(
    private readonly casosSvc: CasosService,
    private readonly usuarios: UsuariosService,
    private readonly rls: TenantRlsService,
  ) {}

  /**
   * Procesa un evento de la PBX. `PbxApiKeyGuard` ya autenticó la API key,
   * resolvió el tenant y confirmó que está vigente — ANTES de que el
   * `ValidationPipe` tocara el body (ver el guard para el porqué de este
   * orden). Aquí solo queda tramitar el evento.
   */
  async webhook(tenant: TenantEntity, dto: WebhookLlamadaDto): Promise<LlamadaEntity> {
    // La central no manda X-Tenant-Id ni sesión: el tenant lo trae ya
    // resuelto el guard, así que `app.tenant` (RLS) se fija DENTRO de
    // esta transacción, no antes.
    return this.rls.conTenant(tenant.codigo, async (manager) => {
      const llamadas = manager.getRepository(LlamadaEntity);

      if (dto?.evento === 'entrante') {
        const crudo = dto.numero?.trim();
        if (!crudo) throw new BadRequestException('El número del llamante es obligatorio.');
        const numero = PbxService.normalizarNumero(crudo);

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
            agentePbx: dto.agente?.trim() || null,
            fechaHoraPbx: dto.fechaHora ? new Date(dto.fechaHora) : null,
            origen: dto.origen ?? 'telefono',
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
        // Muchas centrales solo saben quién contestó al momento de colgar
        // (resumen final de la llamada) — se acepta también aquí, y no pisa
        // lo que ya se hubiera recibido en 'entrante' si esta vez no lo manda.
        if (dto.agente?.trim()) llamada.agentePbx = dto.agente.trim();
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
   * El operador atiende una llamada: crea un caso (con el `canal` que le
   * corresponde a `llamada.origen`: teléfono, chat de WhatsApp o llamada de
   * WhatsApp) o lo enlaza a un caso abierto del mismo número, y marca la
   * llamada como atendida.
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

    const etiqueta = PbxService.ETIQUETA_ORIGEN[llamada.origen ?? 'telefono'];
    // Mismo camino que usa Recepción cuando el operador digita el abonado a
    // mano (CasosService.minimoDeTelefono): reusa el caso abierto del número o
    // crea uno mínimo. Aquí el caso abierto ya se buscó arriba, en la misma
    // transacción que leyó la llamada, así que se pasa resuelto.
    let casoId: string;
    if (abiertoId) {
      casoId = abiertoId;
      await this.casosSvc.agregarNota(tenant, casoId, `${etiqueta.nota} (${llamada.numero}).`, actor.username);
    } else {
      const caso = await this.casosSvc.crear(
        tenant,
        {
          canal: PbxService.CANAL_DE_ORIGEN[llamada.origen ?? 'telefono'],
          titulo: `${etiqueta.titulo} ${llamada.numero}`,
          ciudadano: `${etiqueta.ciudadano} ${llamada.numero}`,
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
      const casoRepo = manager.getRepository(CasoEntity);
      // Idempotente si ya quedó enlazada a ese mismo caso (doble clic,
      // reintento) — PERO el enlace inverso (`caso.llamadaId`) puede seguir
      // faltando: es el caso de `atender()` al lanzar una videollamada desde
      // Recepción, que ya deja la llamada "atendida" con su `casoId`, pero
      // nunca toca el caso. Se completa aquí antes de salir, no solo cuando
      // el resto del método corre completo.
      if (llamada.estado === 'atendida' && llamada.casoId === casoId) {
        const caso = await casoRepo.findOne({ where: { tenant, id: casoId } });
        if (caso && caso.llamadaId !== llamada.id) {
          caso.llamadaId = llamada.id;
          await casoRepo.save(caso);
        }
        return llamada;
      }
      // Solo se enlaza una llamada aún en curso: una perdida o finalizada no
      // puede "resucitar" como atendida.
      if (llamada.estado !== 'sonando') throw new BadRequestException('La llamada ya no está en cola.');
      // El caso debe existir en este tenant: sin esto quedaba cualquier string
      // como enlace y el historial llevaba a un caso inexistente. (El catch
      // cubre un id que ni siquiera es un UUID: para Postgres es un error de
      // sintaxis, para el cliente es el mismo "no existe".)
      const caso = await casoRepo.findOne({ where: { tenant, id: casoId ?? '' } }).catch(() => null);
      if (!caso) throw new BadRequestException('El caso a enlazar no existe.');
      llamada.estado = 'atendida';
      llamada.casoId = caso.id;
      llamada.atendidaPor = actor.username;
      llamada.atendidaEn = new Date();
      // Enlace inverso: el caso también sabe de qué llamada vino, para
      // mostrarla en Consulta sin tener que ir a buscarla en llamadas.
      if (caso.llamadaId !== llamada.id) {
        caso.llamadaId = llamada.id;
        await casoRepo.save(caso);
      }
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
      // Normalizado igual que al entrar: si no, una 'colgada' con el JID crudo
      // no encontraría la llamada que se guardó ya limpia, y quedaría timbrando
      // en la cola para siempre.
      const limpio = PbxService.normalizarNumero(numero.trim());
      return repo.findOne({ where: { tenant, numero: limpio, estado: 'sonando' }, order: { creadoEn: 'DESC' } });
    }
    return Promise.resolve(null);
  }
}
