import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { PbxWebhookLogEntity } from './webhook-log.entity';
import { PeticionPbx } from './pbx-api-key.guard';
import { resolverIpCliente } from '../common/ip-cliente.decorator';

/** Nada de lo que se guarde acá debe crecer sin límite ante un body enorme o repetido. */
const TOPE_CUERPO = 2000;

/**
 * Deja constancia de cada intento AL WEBHOOK DE PBX que termina en error —
 * API key inválida, tenant no vigente (ambos de `PbxApiKeyGuard`), body mal
 * formado (del `ValidationPipe`), o un `colgada` que no ubica la llamada.
 * Responde EXACTAMENTE lo mismo que ya respondía sin este filtro: es
 * logging puro, no cambia el contrato del webhook para la central.
 * Contraparte de `PbxWebhookExitoInterceptor`, que hace lo mismo para las
 * que sí se aceptan — juntos cubren TODA petición al webhook en `pbx_webhook_log`.
 *
 * `PbxApiKeyGuard` corre antes que el `ValidationPipe` (antes que TODO en
 * esta ruta), así que para cuando cualquier excepción llega hasta acá el
 * tenant ya está resuelto en `req.pbxTenant` — salvo, justamente, cuando la
 * API key es la que falló, caso en el que nunca hubo ningún tenant que resolver.
 *
 * Solo se aplica a la ruta del webhook (`@UseFilters` en ese método, no en
 * todo el controlador): los errores de las rutas autenticadas (cola,
 * atender, config…) no son "intentos de la central" y no pertenecen aquí.
 */
@Injectable()
@Catch(HttpException)
export class PbxWebhookRechazoFilter implements ExceptionFilter {
  private readonly log = new Logger(PbxWebhookRechazoFilter.name);

  constructor(
    @InjectRepository(PbxWebhookLogEntity)
    private readonly repo: Repository<PbxWebhookLogEntity>,
  ) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<PeticionPbx>();
    const res = ctx.getResponse<Response>();
    const estado = exception.getStatus();
    const cuerpoRespuesta = exception.getResponse();
    const mensaje = typeof cuerpoRespuesta === 'string' ? cuerpoRespuesta : (cuerpoRespuesta as { message?: unknown })?.message;
    // El ValidationPipe manda un array de mensajes (uno por campo inválido);
    // el resto de las excepciones, un solo string.
    const motivo = Array.isArray(mensaje) ? mensaje.join(' | ') : typeof mensaje === 'string' ? mensaje : JSON.stringify(cuerpoRespuesta);

    res.status(estado).json(cuerpoRespuesta);

    // Nunca debe tumbar la respuesta real al webhook: si falla el guardado,
    // solo se registra en el log del proceso y sigue.
    this.repo.save(this.repo.create({
      tenant: req.pbxTenant?.codigo ?? null,
      exitoso: false,
      estadoHttp: estado,
      evento: (req.body as { evento?: string })?.evento ?? null,
      motivo,
      ip: resolverIpCliente(req),
      cuerpo: req.body ? JSON.stringify(req.body).slice(0, TOPE_CUERPO) : null,
    })).catch((e) => this.log.warn(`No se pudo registrar el rechazo del webhook: ${(e as Error).message}`));
  }
}
