import { Injectable, Logger } from '@nestjs/common';
import { RemitenteSms, aE164 } from './sms.types';

/**
 * Infobip — POST /sms/3/messages, autenticado con `Authorization: App <apiKey>`.
 * El host NO es fijo: Infobip asigna uno por cuenta (xxxxx.api.infobip.com) y
 * viene en la configuración de la instancia.
 */
@Injectable()
export class InfobipRemitente implements RemitenteSms {
  private readonly logger = new Logger(InfobipRemitente.name);

  async enviar(
    cfg: { baseUrl?: string | null; apiKey: string; sender?: string | null },
    numero: string,
    mensaje: string,
  ): Promise<boolean> {
    const destino = aE164(numero);
    if (!destino) {
      this.logger.warn(`Número de destino inválido para SMS: ${numero}`);
      return false;
    }

    const host = (cfg.baseUrl ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!host) {
      this.logger.warn('Infobip sin host configurado — SMS NO enviado.');
      return false;
    }

    const cuerpo = {
      messages: [{
        destinations: [{ to: destino }],
        content: { text: mensaje },
        ...(cfg.sender?.trim() ? { from: cfg.sender.trim() } : {}),
      }],
    };

    try {
      const res = await fetch(`https://${host}/sms/3/messages`, {
        method: 'POST',
        headers: {
          Authorization: `App ${cfg.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(cuerpo),
      });
      const texto = await res.text();

      if (!res.ok) {
        this.logger.warn(`Infobip rechazó el SMS (${res.status}) para ${destino}: ${texto.slice(0, 300)}`);
        return false;
      }
      this.logger.log(`Infobip aceptó el SMS para ${destino}.`);
      return true;
    } catch (e) {
      this.logger.error(`Error llamando a Infobip para ${destino}: ${(e as Error)?.message}`);
      return false;
    }
  }
}
