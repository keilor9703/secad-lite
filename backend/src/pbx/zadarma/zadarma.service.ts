import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigPbxEntity } from '../config-pbx.entity';
import { TenantEntity } from '../../tenants/tenant.entity';
import { PbxService, WebhookLlamadaDto } from '../pbx.service';
import { descifrar } from '../../common/secretos';
import { CuerpoZadarma, EVENTOS_ZADARMA, EventoZadarma, verificarFirma } from './zadarma.firma';

/**
 * Traductor entre la centralita de Zadarma y el modelo de llamadas de FALCON.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN TRADUCTOR Y NO UN SEGUNDO SISTEMA
 *
 * FALCON ya tiene un modelo de llamada entrante —cola en vivo, aviso al
 * operador, «atender» que abre el caso— y lo alimenta un webhook genérico de
 * dos eventos (`entrante`, `colgada`). Ese modelo funciona hoy en producción
 * con YACO. Zadarma habla otro idioma: seis eventos por llamada, firmados, en
 * `x-www-form-urlencoded`.
 *
 * Lo que se hace aquí es TRADUCIR, no reemplazar. La cola, el aviso en vivo,
 * el screen-pop y los permisos siguen siendo los mismos para las dos plantas,
 * y el día que entre una tercera se escribe otro traductor y nada más. Si en
 * vez de esto Zadarma tuviera su propia cola, habría dos verdades sobre qué
 * llamadas hay sonando — y la que vería el operador dependería de con qué
 * planta trabaja su municipio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL MAPA DE EVENTOS, Y LO QUE DELIBERADAMENTE NO HACE
 *
 *  NOTIFY_START      → `entrante`. Timbra en la cola, sin destinatario: la
 *                      centralita todavía no decidió a quién se la ofrece.
 *  NOTIFY_INTERNAL   → la misma llamada, ya dirigida a una extensión. No crea
 *                      otra: completa la que existe y reenvía el aviso.
 *  NOTIFY_ANSWER     → quién descolgó, para el registro. **No** la marca como
 *                      «atendida» en FALCON: atendida significa que alguien la
 *                      tomó DESDE la aplicación y se le abrió el caso. Mientras
 *                      se conteste por softphone, son dos cosas distintas y
 *                      fingir que son una sola pondría casos vacíos en el
 *                      tablero. Cuando se conteste dentro de FALCON (WebRTC),
 *                      coincidirán solas.
 *  NOTIFY_END        → `colgada`. Y con él NOTIFY_INTERNAL_END y —ojo—
 *                      NOTIFY_OUT_END: lo que decide cuál llamada se cierra es
 *                      el `pbx_call_id`, no el nombre del evento. Ver
 *                      `colgada()`, que explica por qué cuesta una llamada
 *                      colgada para siempre en la cola.
 *  NOTIFY_OUT_START  → saliente: se registra en la bitácora del webhook y no
 *                      entra a la cola. La cola de un CAD es de lo que ENTRA;
 *                      meter ahí lo que marca un operador la vuelve inútil.
 *  NOTIFY_RECORD     → todavía no: la grabación es el paso siguiente.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Lo que el controlador necesita saber para responderle a Zadarma. */
export interface ResultadoZadarma {
  /** Lo que se le contesta. Zadarma lee el cuerpo en NOTIFY_START (IVR). */
  cuerpo: unknown;
  /** Qué se hizo, para la bitácora del webhook. */
  resumen: string;
  llamadaId?: string | null;
}

@Injectable()
export class ZadarmaService {
  private readonly log = new Logger(ZadarmaService.name);

  constructor(
    @InjectRepository(ConfigPbxEntity) private readonly config: Repository<ConfigPbxEntity>,
    private readonly pbx: PbxService,
  ) {}

  /** La configuración de la instancia, o null si nunca se guardó. */
  configDe(tenant: string): Promise<ConfigPbxEntity | null> {
    return this.config.findOne({ where: { tenant } });
  }

  /** El secreto en claro, para verificar firmas y firmar llamadas a la API. */
  secretoDe(cfg: ConfigPbxEntity | null): string {
    if (!cfg?.zadarmaSecreto) return '';
    try {
      return descifrar(cfg.zadarmaSecreto, this.llaveDeCifrado());
    } catch {
      this.log.error(
        `No se pudo descifrar el secreto de Zadarma de «${cfg.tenant}»: la llave de cifrado cambió. `
        + 'Vuelva a guardarlo en Plataforma.',
      );
      return '';
    }
  }

  private llaveDeCifrado(): string {
    return process.env.JWT_SECRET ?? '';
  }

  /**
   * Procesa un webhook ya autenticado (el tenant salió de la URL y la firma
   * se verificó antes de llegar aquí).
   *
   * No lanza por un evento que no sepa traducir: Zadarma reintenta lo que no
   * recibe un 200, y un reintento infinito de `NOTIFY_IVR` no arregla nada.
   * Se responde 200 y queda anotado qué se ignoró.
   */
  async procesar(tenant: TenantEntity, cuerpo: CuerpoZadarma): Promise<ResultadoZadarma> {
    const evento = cuerpo.event as EventoZadarma | undefined;
    if (!evento || !(EVENTOS_ZADARMA as readonly string[]).includes(evento)) {
      return { cuerpo: { ok: true }, resumen: `Evento desconocido, ignorado: ${evento ?? '(ninguno)'}` };
    }

    switch (evento) {
      case 'NOTIFY_START':
        return this.entrante(tenant, cuerpo, null);

      case 'NOTIFY_INTERNAL':
        // La misma llamada, ahora con destino. `PbxService` reconoce el callId
        // y completa la extensión en vez de duplicar la fila.
        return this.entrante(tenant, cuerpo, cuerpo.internal ?? null);

      case 'NOTIFY_ANSWER': {
        const llamada = await this.pbx.webhook(tenant, this.dto(cuerpo, {
          evento: 'entrante',
          extension: cuerpo.internal ?? undefined,
          agente: cuerpo.internal ?? undefined,
        }));
        return {
          cuerpo: { ok: true },
          resumen: `Contestada por la extensión ${cuerpo.internal ?? '(sin dato)'}`,
          llamadaId: llamada?.id ?? null,
        };
      }

      case 'NOTIFY_END':
      case 'NOTIFY_INTERNAL_END':
      // Sí, también el fin de una saliente cierra: ver `colgada()`.
      case 'NOTIFY_OUT_END':
        return this.colgada(tenant, cuerpo, evento);

      case 'NOTIFY_OUT_START':
        // Saliente: queda en la bitácora del webhook y no toca la cola.
        return {
          cuerpo: { ok: true },
          resumen: `Saliente ${cuerpo.internal ?? '?'} → ${cuerpo.destination ?? '?'}, no entra a la cola`,
        };

      case 'NOTIFY_RECORD':
        return { cuerpo: { ok: true }, resumen: 'Grabación disponible; descarga todavía no implementada' };

      default:
        return { cuerpo: { ok: true }, resumen: `Evento sin traducción: ${evento}` };
    }
  }

  /**
   * Fin de llamada: cierra la que nombre el aviso, si queda alguna abierta.
   *
   * ES EL MISMO CAMINO PARA LOS TRES AVISOS DE FIN, Y ESO ES LO IMPORTANTE.
   *
   * Zadarma no cuenta el fin de una llamada con un solo evento. Una llamada
   * entre extensiones entra como `NOTIFY_INTERNAL` —y FALCON la pone en la
   * cola— pero su fin puede llegar como `NOTIFY_OUT_END`, porque desde la
   * extensión que marcó fue una saliente. Mientras `NOTIFY_OUT_END` se
   * ignoraba por ser «saliente», colgar en el softphone no colgaba en FALCON:
   * la llamada se quedaba timbrando en la cola y solo se podía cerrar a mano
   * por la API. Pasa igual con los avisos duplicados (el fin de la pata
   * interna y el de la saliente, los dos por la misma llamada).
   *
   * Por eso lo que decide no es el NOMBRE del evento sino el `pbx_call_id`:
   * si hay una llamada con ese id, se cierra; si no, no había nada que cerrar
   * —una saliente de verdad nunca creó fila— y eso no es un error. La
   * alternativa, tratarlo como un `colgada` normal, responde 404 a Zadarma, y
   * un 404 lo reintenta hasta cansarse.
   */
  private async colgada(
    tenant: TenantEntity, cuerpo: CuerpoZadarma, evento: EventoZadarma,
  ): Promise<ResultadoZadarma> {
    const llamada = await this.pbx.cerrarSiEstaEnCola(tenant, this.dto(cuerpo, {
      evento: 'colgada',
      // `internal` NO siempre es quien contestó. En un fin de entrante sí; en
      // un `NOTIFY_OUT_END` es la extensión que MARCÓ, y tomársela por el
      // agente pisaba al que de verdad descolgó: en la primera prueba real
      // 101→102 la llamada quedó atribuida a la 101. Eso se ve en el
      // historial del municipio, así que ahí no se toca el agente.
      agente: evento === 'NOTIFY_OUT_END' ? undefined : cuerpo.internal ?? undefined,
      // `answered` es la palabra de la central: alguien descolgó. Sin esto,
      // una llamada atendida por softphone se contaba como perdida.
      atendidaEnPlanta: cuerpo.disposition === 'answered',
    }));
    const detalle = `${cuerpo.disposition ?? 'sin disposición'}, ${cuerpo.duration ?? '?'} s`;
    if (llamada) {
      return {
        cuerpo: { ok: true },
        // «Ya estaba cerrada» no es lo mismo que «se cerró», y la bitácora
        // tenía que poder decirlo: el fin de una llamada llega dos veces.
        resumen: llamada.cambio
          ? `Colgada (${detalle})`
          : `Ya estaba cerrada (${llamada.llamada.estado}); este aviso de fin no cambió nada`,
        llamadaId: llamada.llamada.id,
      };
    }
    return {
      cuerpo: { ok: true },
      resumen: evento === 'NOTIFY_OUT_END'
        ? `Saliente ${cuerpo.internal ?? '?'} → ${cuerpo.destination ?? '?'} terminada `
          + `(${detalle}); no estaba en la cola, nada que cerrar`
        : `Fin de llamada (${detalle}) sin nada que cerrar: `
          + `ninguna llamada con el id ${cuerpo.pbx_call_id || '(sin id)'}`,
    };
  }

  /** Alta (o completado) de una llamada entrante. */
  private async entrante(
    tenant: TenantEntity, cuerpo: CuerpoZadarma, extension: string | null,
  ): Promise<ResultadoZadarma> {
    const llamada = await this.pbx.webhook(tenant, this.dto(cuerpo, {
      evento: 'entrante',
      extension: extension ?? undefined,
    }));
    return {
      cuerpo: { ok: true },
      resumen: extension
        ? `Dirigida a la extensión ${extension}`
        : `Entrante de ${cuerpo.caller_id ?? '(sin número)'}`,
      llamadaId: llamada?.id ?? null,
    };
  }

  /**
   * El cuerpo de Zadarma, en el DTO interno.
   *
   * `call_start` llega como «2026-10-15 09:12:33» (hora de la centralita, sin
   * zona). Se convierte a ISO con la T que exige el validador; sin zona
   * horaria queda ambiguo, y eso se acepta a propósito: es el dato de la
   * central, informativo, y FALCON sella su propio instante de recepción.
   */
  private dto(cuerpo: CuerpoZadarma, extra: Partial<WebhookLlamadaDto>): WebhookLlamadaDto {
    const dto = new WebhookLlamadaDto();
    dto.evento = extra.evento ?? 'entrante';
    dto.callId = cuerpo.pbx_call_id || cuerpo.call_id_with_rec || undefined;
    dto.numero = cuerpo.caller_id || undefined;
    dto.numeroDestino = cuerpo.called_did || cuerpo.destination || undefined;
    dto.fechaHora = fechaIso(cuerpo.call_start);
    dto.origen = 'telefono';
    if (extra.extension) dto.extension = extra.extension;
    if (extra.agente) dto.agente = extra.agente;
    if (extra.atendidaEnPlanta !== undefined) dto.atendidaEnPlanta = extra.atendidaEnPlanta;
    return dto;
  }
}

/** «2026-10-15 09:12:33» → «2026-10-15T09:12:33». Lo que no cuadre, se omite. */
export function fechaIso(valor: string | undefined): string | undefined {
  const v = String(valor ?? '').trim();
  if (!v) return undefined;
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}
