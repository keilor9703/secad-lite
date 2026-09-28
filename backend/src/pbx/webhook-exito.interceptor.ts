import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PbxWebhookLogEntity } from './webhook-log.entity';
import { LlamadaEntity } from './llamada.entity';
import { resolverIpCliente } from '../common/ip-cliente.decorator';

const TOPE_CUERPO = 2000;

/**
 * Deja constancia de cada petición al webhook de PBX que SÍ se acepta —
 * contraparte de `PbxWebhookRechazoFilter`, que hace lo mismo para las que
 * se rechazan. Juntos cubren toda petición en `pbx_webhook_log`; la que se
 * acepta además apunta (`llamadaId`) a su registro de negocio en `llamadas`.
 * No cambia la respuesta: solo observa lo que el controlador ya devolvió.
 */
@Injectable()
export class PbxWebhookExitoInterceptor implements NestInterceptor {
  private readonly log = new Logger(PbxWebhookExitoInterceptor.name);

  constructor(
    @InjectRepository(PbxWebhookLogEntity)
    private readonly repo: Repository<PbxWebhookLogEntity>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      tap((llamada: LlamadaEntity) => {
        // Nunca debe tumbar la respuesta real al webhook: si falla el
        // guardado, solo se registra en el log del proceso y sigue.
        this.repo.save(this.repo.create({
          tenant: llamada?.tenant ?? null,
          exitoso: true,
          estadoHttp: 201,
          evento: (req.body as { evento?: string })?.evento ?? null,
          motivo: null,
          llamadaId: llamada?.id ?? null,
          ip: resolverIpCliente(req),
          cuerpo: req.body ? JSON.stringify(req.body).slice(0, TOPE_CUERPO) : null,
        })).catch((e) => this.log.warn(`No se pudo registrar la petición aceptada del webhook: ${(e as Error).message}`));
      }),
    );
  }
}
