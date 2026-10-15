import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { LlamadaEntity } from './llamada.entity';
import { PbxWebhookLogService } from './webhook-log.service';

/**
 * Deja constancia de cada petición al webhook genérico de PBX que SÍ se
 * acepta — contraparte de `PbxWebhookRechazoFilter`, que hace lo mismo para
 * las que se rechazan. Juntos cubren toda petición de esa ruta en
 * `pbx_webhook_log`; la que se acepta además apunta (`llamadaId`) a su
 * registro de negocio en `llamadas`. No cambia la respuesta: solo observa lo
 * que el controlador ya devolvió.
 *
 * NO sirve para la ruta de Zadarma: ahí un rechazo se responde con 200 y un
 * motivo en el cuerpo, así que esto lo vería como un éxito. Esa ruta anota
 * ella misma, con `PbxWebhookLogService`.
 */
@Injectable()
export class PbxWebhookExitoInterceptor implements NestInterceptor {
  constructor(private readonly bitacora: PbxWebhookLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      tap((llamada: LlamadaEntity) => {
        this.bitacora.registrar(req, {
          tenant: llamada?.tenant ?? null,
          exitoso: true,
          estadoHttp: 201,
          motivo: null,
          llamadaId: llamada?.id ?? null,
        });
      }),
    );
  }
}
