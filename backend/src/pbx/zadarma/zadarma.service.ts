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
 *  NOTIFY_END        → `colgada`.
 *  NOTIFY_OUT_*      → salientes: se registran en la bitácora del webhook y no
 *                      entran a la cola. La cola de un CAD es de lo que ENTRA;
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
      case 'NOTIFY_INTERNAL_END': {
        const llamada = await this.pbx.webhook(tenant, this.dto(cuerpo, {
          evento: 'colgada',
          agente: cuerpo.internal ?? undefined,
          // `answered` es la palabra de la central: alguien descolgó. Sin
          // esto, una llamada atendida por softphone se contaba como perdida.
          atendidaEnPlanta: cuerpo.disposition === 'answered',
        }));
        return {
          cuerpo: { ok: true },
          resumen: `Colgada (${cuerpo.disposition ?? 'sin disposición'}, ${cuerpo.duration ?? '?'} s)`,
          llamadaId: llamada?.id ?? null,
        };
      }

      case 'NOTIFY_OUT_START':
      case 'NOTIFY_OUT_END':
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
