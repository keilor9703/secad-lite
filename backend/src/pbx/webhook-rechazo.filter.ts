import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request, Response } from 'express';
import { PbxWebhookLogEntity } from './webhook-log.entity';
import { TenantsService } from '../tenants/tenants.service';
import { resolverIpCliente } from '../common/ip-cliente.decorator';

/** Nada de lo que se guarde acá debe crecer sin límite ante un body enorme o repetido. */
const TOPE_CUERPO = 2000;

/**
 * Deja constancia de cada intento AL WEBHOOK DE PBX que termina en error —
 * API key inválida, tenant no vigente, body mal formado (incluye lo que
 * rechaza el ValidationPipe, no solo lo que lanza PbxService), o un
 * `colgada` que no ubica la llamada. Responde EXACTAMENTE lo mismo que ya
 * respondía sin este filtro (mismo formato que el manejador por defecto de
 * Nest, y antes de que el registro siquiera empiece a resolverse): es
 * logging puro, no cambia el contrato del webhook para la central.
 * Contraparte de `PbxWebhookExitoInterceptor`, que hace lo mismo para las
 * que sí se aceptan — juntos cubren TODA petición al webhook en `pbx_webhook_log`.
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
    private readonly tenants: TenantsService,
  ) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const estado = exception.getStatus();
    const cuerpoRespuesta = exception.getResponse();
    const mensaje = typeof cuerpoRespuesta === 'string' ? cuerpoRespuesta : (cuerpoRespuesta as { message?: unknown })?.message;
    // El ValidationPipe manda un array de mensajes (uno por campo inválido);
    // el resto de las excepciones, un solo string.
    const motivo = Array.isArray(mensaje) ? mensaje.join(' | ') : typeof mensaje === 'string' ? mensaje : JSON.stringify(cuerpoRespuesta);

    // La respuesta a la central sale YA, sin esperar a que el registro se
    // resuelva (puede necesitar consultar la base, ver abajo) — el registro
    // nunca debe agregarle latencia al webhook, y mucho menos tumbarlo.
    res.status(estado).json(cuerpoRespuesta);

    this.registrar(exception, req, estado, motivo)
      .catch((e) => this.log.warn(`No se pudo registrar el rechazo del webhook: ${(e as Error).message}`));
  }

  private async registrar(exception: HttpException, req: Request, estado: number, motivo: string): Promise<void> {
    // PbxService.webhook ya deja el tenant resuelto en la excepción cuando
    // alcanzó a identificarlo antes de rechazar. Pero un body mal formado
    // (falta "numero", "origen" inválido, etc.) lo rechaza el ValidationPipe
    // ANTES de que el controlador siquiera se ejecute — PbxService nunca
    // llega a correr, así que nunca mira la API key. Es justo el caso más
    // común al integrar una central nueva, y "qué tenant mandó esto" es lo
    // primero que se pregunta para diagnosticarlo — así que si no vino ya
    // resuelta, se intenta acá con la misma API key del header.
    let tenant = (exception as HttpException & { tenantPbx?: string }).tenantPbx ?? null;
    if (!tenant) {
      const apiKey = this.apiKeyDe(req);
      if (apiKey) {
        const t = await this.tenants.porApiKey(apiKey).catch(() => null);
        tenant = t?.codigo ?? null;
      }
    }

    await this.repo.save(this.repo.create({
      tenant,
      exitoso: false,
      estadoHttp: estado,
      evento: (req.body as { evento?: string })?.evento ?? null,
      motivo,
      ip: resolverIpCliente(req),
      cuerpo: req.body ? JSON.stringify(req.body).slice(0, TOPE_CUERPO) : null,
    }));
  }

  private apiKeyDe(req: Request): string | undefined {
    const v = req.headers['x-api-key'];
    return Array.isArray(v) ? v[0] : v;
  }
}
