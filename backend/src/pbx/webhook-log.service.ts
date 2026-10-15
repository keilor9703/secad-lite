import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PbxWebhookLogEntity } from './webhook-log.entity';
import { PeticionConIp, resolverIpCliente } from '../common/ip-cliente.decorator';

/** Nada de lo que se guarde acá debe crecer sin límite ante un body enorme o repetido. */
const TOPE_CUERPO = 2000;

/** Lo único que hace falta de la petición — así se prueba sin un `Request` de verdad. */
export type PeticionWebhook = PeticionConIp & { body?: unknown };

/** Lo que el llamador sabe y la petición no dice. */
export interface AnotacionWebhook {
  tenant?: string | null;
  exitoso: boolean;
  estadoHttp: number;
  /** Qué se hizo, o por qué no se hizo nada. Null solo cuando no hay nada que contar. */
  motivo?: string | null;
  llamadaId?: string | null;
  /** Se toma del body (`evento` o `event`) si no se indica. */
  evento?: string | null;
}

/**
 * La bitácora del webhook de PBX: una fila por petición, se acepte o se
 * rechace. Es donde se mira cuando «la central dice que lo mandó».
 *
 * Está aparte del interceptor y del filtro porque hay una ruta —la de
 * Zadarma— que no puede usar ninguno de los dos: ahí un rechazo se responde
 * con 200 (Zadarma reintenta todo lo que no sea 200), así que no hay
 * excepción que el filtro pueda atrapar, y el interceptor veía ese
 * `{ ok: false, motivo }` como un éxito y lo anotaba como tal. El resultado
 * era una bitácora que decía «exitoso» de todo, sin motivo, sin tenant y sin
 * el nombre del evento: justo cuando hizo falta para entender por qué una
 * llamada no se colgaba, no sirvió de nada.
 */
@Injectable()
export class PbxWebhookLogService {
  private readonly log = new Logger(PbxWebhookLogService.name);

  constructor(
    @InjectRepository(PbxWebhookLogEntity)
    private readonly repo: Repository<PbxWebhookLogEntity>,
  ) {}

  /**
   * Anota la petición SIN hacer esperar a la central: el guardado va por su
   * cuenta y un fallo de base nunca tumba la respuesta al webhook —antes que
   * perder una llamada por no poder registrarla, se pierde el registro.
   */
  registrar(req: PeticionWebhook, datos: AnotacionWebhook): void {
    const body = (req?.body ?? null) as { evento?: string; event?: string } | null;
    this.repo
      .save(this.repo.create({
        tenant: datos.tenant ?? null,
        exitoso: datos.exitoso,
        estadoHttp: datos.estadoHttp,
        // `evento` es el campo del webhook genérico; `event`, el de Zadarma.
        // Mirar solo el primero dejaba la columna en null para TODA petición
        // de Zadarma, que es la que más falta hace leer.
        evento: (datos.evento ?? body?.evento ?? body?.event ?? null)?.slice(0, 20) ?? null,
        motivo: datos.motivo ?? null,
        llamadaId: datos.llamadaId ?? null,
        ip: resolverIpCliente(req),
        cuerpo: body ? JSON.stringify(body).slice(0, TOPE_CUERPO) : null,
      }))
      .catch((e) => this.log.warn(`No se pudo registrar la petición del webhook: ${(e as Error).message}`));
  }
}
