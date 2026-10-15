import { Injectable, Logger } from '@nestjs/common';

/**
 * Salida de correo de FALCON CAD.
 *
 * Detrás de esta interfaz está Brevo, pero el resto del sistema no lo sabe:
 * el proveedor de correo es la clase de dependencia que se cambia (precio,
 * entregabilidad, una exigencia de residencia de datos de un cliente), y
 * cuando eso pase no debe haber que tocar el módulo de usuarios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DOS REGLAS QUE NO SON DE ESTILO:
 *
 *  1. **Enviar NUNCA tumba la operación.** `enviar()` no lanza: devuelve si
 *     salió o no y por qué. Quien llama decide qué hacer con el fallo. Crear
 *     un usuario no puede abortarse porque un tercero esté caído.
 *
 *  2. **Las plantillas viven aquí, en el repositorio.** No en el editor del
 *     proveedor. Así se revisan en un diff, se prueban, y migrar de proveedor
 *     no significa volver a escribirlas.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  /** Alternativa en texto plano. Sin ella, varios filtros puntúan peor el mensaje. */
  texto: string;
  /**
   * A dónde contesta quien recibe, cuando no es el remitente.
   *
   * Existe por los tickets de soporte: el aviso lo manda `avisos@…`, que es un
   * buzón que nadie lee, y la mesa necesita poder pulsar «Responder» y escribirle
   * a la persona que reportó. Sin esto la respuesta se va al vacío y el ticket
   * queda contestado para la mesa y sin contestar para quien lo abrió.
   */
  responderA?: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  /** Identificador del proveedor, para cruzar con sus registros cuando algo no llegó. */
  id?: string;
  /** Por qué falló, recortado para caber en la columna que lo guarda. */
  error?: string;
}

@Injectable()
export class CorreoService {
  private readonly logger = new Logger(CorreoService.name);

  private readonly apiKey = process.env.BREVO_API_KEY ?? '';
  private readonly remitente = process.env.CORREO_REMITENTE ?? 'avisos@mail.falconcad.com.co';
  private readonly remitenteNombre = process.env.CORREO_REMITENTE_NOMBRE ?? 'FALCON CAD';
  private readonly url = process.env.BREVO_API_URL ?? 'https://api.brevo.com/v3/smtp/email';

  /** Sin clave configurada no se envía nada: desarrollo, pruebas, o un despliegue a medias. */
  get configurado(): boolean {
    return !!this.apiKey;
  }

  /**
   * Envía y devuelve el resultado. No lanza nunca — ni por red, ni por un 400
   * del proveedor, ni por una respuesta que no sea JSON.
   */
  async enviar(m: MensajeCorreo): Promise<ResultadoEnvio> {
    if (!this.configurado) {
      // En desarrollo esto es lo normal. Se registra el asunto y a quién iba,
      // nunca el cuerpo: ahí va el enlace de activación, que es una credencial.
      this.logger.warn(`Sin BREVO_API_KEY: no se envió «${m.asunto}» a ${m.para}.`);
      return { ok: false, error: 'El envío de correo no está configurado en este servidor.' };
    }
    if (!DIRECCION.test(m.para ?? '')) {
      return { ok: false, error: 'La dirección de correo no tiene forma válida.' };
    }

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.remitente, name: this.remitenteNombre },
          to: [{ email: m.para }],
          // Una dirección mal formada aquí la rechaza el proveedor con un 400 y
          // tumba el envío entero: si no tiene forma de correo, mejor sin
          // `replyTo` que sin mensaje.
          ...(DIRECCION.test(m.responderA ?? '') ? { replyTo: { email: m.responderA } } : {}),
          subject: m.asunto,
          htmlContent: m.html,
          textContent: m.texto,
        }),
        // Sin tope, una API lenta deja la petición colgada y con ella el alta.
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        return { ok: false, error: recortar(`HTTP ${res.status} ${detalle}`) };
      }
      const cuerpo = (await res.json().catch(() => ({}))) as { messageId?: string };
      return { ok: true, id: cuerpo?.messageId };
    } catch (e) {
      return { ok: false, error: recortar((e as Error)?.message ?? 'Error desconocido al enviar.') };
    }
  }
}

/**
 * Forma de una dirección de correo. No valida que exista —eso solo lo dice un
 * envío— pero descarta lo que el proveedor rechazaría con un 400.
 */
const DIRECCION = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** La columna que guarda el error son 300 caracteres. */
function recortar(texto: string): string {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > 290 ? `${limpio.slice(0, 290)}…` : limpio;
}
