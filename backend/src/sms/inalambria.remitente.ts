import { Injectable, Logger } from '@nestjs/common';
import { RemitenteSms, aE164 } from './sms.types';

/** Host de Inalambria Express cuando la instancia no configura otro. */
const HOST_POR_DEFECTO = 'https://api.inalambria.com/v1';

/**
 * Inalambria Express — POST /messages/send con `Authorization: Bearer <apiKey>`.
 *
 * `async: false` a propósito: se pide el envío síncrono para que la respuesta
 * diga si el proveedor lo aceptó de verdad. En modo asíncrono contesta 200 al
 * encolar y no habría forma de decirle al despachador que el SMS no salió.
 */
@Injectable()
export class InalambriaRemitente implements RemitenteSms {
  private readonly logger = new Logger(InalambriaRemitente.name);

  async enviar(
    cfg: { baseUrl?: string | null; apiKey: string },
    numero: string,
    mensaje: string,
  ): Promise<boolean> {
    const destino = aE164(numero);
    if (!destino) {
      this.logger.warn(`Número de destino inválido para SMS: ${numero}`);
      return false;
    }

    const host = (cfg.baseUrl?.trim() || HOST_POR_DEFECTO).replace(/\/+$/, '');

    try {
      const res = await fetch(`${host}/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: mensaje, recipients: [destino], async: false }),
      });
      const texto = await res.text();

      if (!res.ok) {
        this.logger.warn(`Inalambria rechazó el SMS (${res.status}) para ${destino}: ${texto.slice(0, 300)}`);
        return false;
      }
      this.logger.log(`Inalambria aceptó el SMS para ${destino}.`);
      return true;
    } catch (e) {
      this.logger.error(`Error llamando a Inalambria para ${destino}: ${(e as Error)?.message}`);
      return false;
    }
  }
}
