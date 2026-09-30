import { Injectable, Logger } from '@nestjs/common';
import { RemitenteSms, aE164 } from './sms.types';

/** Grupos de estado de Infobip que significan «esto no va a llegar». */
const GRUPOS_FALLIDOS = ['REJECTED', 'UNDELIVERABLE', 'EXPIRED'];

/** Lo que devuelve Infobip por cada mensaje enviado. */
interface RespuestaInfobip {
  messages?: Array<{
    messageId?: string;
    status?: { groupName?: string; name?: string; description?: string };
  }>;
}

/**
 * Infobip — POST /sms/3/messages, autenticado con `Authorization: App <apiKey>`.
 * El host NO es fijo: Infobip asigna uno por cuenta (xxxxx.api.infobip.com) y
 * viene en la configuración de la instancia.
 *
 * Un 200 de esta API significa «recibido para procesar», NO «entregado». La
 * respuesta trae un estado por mensaje, y ahí es donde se ve si el mensaje fue
 * rechazado —cuenta sin aprobar, remitente no registrado, destino bloqueado—.
 * Sin mirarlo, el sistema decía «Enlace enviado por SMS» mientras al ciudadano
 * no le llegaba nada, que es peor que decir que falló: el despachador se queda
 * esperando en vez de dictarle el enlace por teléfono.
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
        // El campo es `sender`. `from` es de la API vieja (/sms/2/text/advanced)
        // y en la v3 se ignora en silencio: el mensaje salía con el remitente
        // por defecto de la cuenta y el configurado aquí no se aplicaba nunca.
        ...(cfg.sender?.trim() ? { sender: cfg.sender.trim() } : {}),
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

      // 200 no basta: hay que mirar el estado del mensaje.
      let estado: { groupName?: string; name?: string; description?: string } | undefined;
      let messageId: string | undefined;
      try {
        const datos = JSON.parse(texto) as RespuestaInfobip;
        estado = datos.messages?.[0]?.status;
        messageId = datos.messages?.[0]?.messageId;
      } catch {
        // Respuesta que no es JSON: se acepta como antes, pero queda constancia.
        this.logger.warn(`Infobip respondió 200 con un cuerpo ilegible para ${destino}: ${texto.slice(0, 200)}`);
        return true;
      }

      const grupo = (estado?.groupName ?? '').toUpperCase();
      if (GRUPOS_FALLIDOS.includes(grupo)) {
        this.logger.warn(
          `Infobip NO va a entregar el SMS a ${destino}: ${grupo}/${estado?.name} — ` +
          `${estado?.description ?? 'sin detalle'} (messageId ${messageId ?? 'desconocido'})`);
        return false;
      }

      // El identificador se registra para poder rastrear el mensaje en el
      // portal de Infobip cuando alguien diga «no me llegó».
      this.logger.log(
        `Infobip aceptó el SMS para ${destino}: ${grupo || 'sin estado'}/${estado?.name ?? '—'} ` +
        `(messageId ${messageId ?? 'desconocido'})`);
      return true;
    } catch (e) {
      this.logger.error(`Error llamando a Infobip para ${destino}: ${(e as Error)?.message}`);
      return false;
    }
  }
}
