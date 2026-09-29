import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** Lo que el token lleva firmado. Es todo lo que hace falta para atender al ciudadano. */
export interface DatosTokenVideo {
  sesionId: string;
  casoId: string;
  tenant: string;
  /** Quién abrió la llamada. Va para la trazabilidad, no para autorizar. */
  despachador: string;
}

/**
 * El token que ES el enlace del ciudadano (.../video/{token}).
 *
 * Autocontenido y firmado: no se guarda en ninguna parte, su validez la da la
 * firma y la expiración. El ciudadano no tiene cuenta en FALCON y no va a
 * tenerla —está llamando al 123 desde la calle— así que esto es lo único que lo
 * autentica.
 *
 * Va firmado con un secreto PROPIO, distinto del de las sesiones de usuario.
 * Si fuera el mismo, un token de video —que se manda por SMS, viaja en claro y
 * queda en el historial del celular de un desconocido— estaría firmado con la
 * misma llave que las sesiones de los funcionarios.
 *
 * Lleva el TENANT dentro porque el ciudadano no pasa por el resolutor de
 * instancia: no manda cabecera ni tiene sesión. Y va dentro del token firmado,
 * no como parámetro, porque un parámetro lo pondría quien llama.
 */
@Injectable()
export class VideoTokenService {
  private readonly logger = new Logger(VideoTokenService.name);
  private readonly minutos: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.minutos = Number(config.get<string>('VIDEO_TOKEN_MINUTOS', '15')) || 15;
  }

  get minutosPorDefecto(): number {
    return this.minutos;
  }

  /** Firma un enlace que vence en `expiraEn`. */
  crear(datos: DatosTokenVideo, expiraEn: Date): string {
    const segundos = Math.max(60, Math.floor((expiraEn.getTime() - Date.now()) / 1000));
    return this.jwt.sign(
      { sid: datos.sesionId, cid: datos.casoId, tnt: datos.tenant, dsp: datos.despachador },
      { secret: this.secreto(), expiresIn: segundos, issuer: EMISOR, audience: EMISOR },
    );
  }

  /** Devuelve lo que lleva dentro, o null si no sirve (firma, vencimiento, emisor). */
  validar(token: string | undefined | null): DatosTokenVideo | null {
    if (!token?.trim()) return null;
    try {
      const p = this.jwt.verify<{ sid: string; cid: string; tnt: string; dsp?: string }>(
        token.trim(),
        { secret: this.secreto(), issuer: EMISOR, audience: EMISOR },
      );
      if (!p?.sid || !p?.tnt) return null;
      return { sesionId: p.sid, casoId: p.cid, tenant: p.tnt, despachador: p.dsp ?? '' };
    } catch {
      // Vencido, alterado o de otro emisor: para el ciudadano es lo mismo —el
      // enlace ya no sirve— y distinguirlo solo ayudaría a quien lo esté probando.
      return null;
    }
  }

  private secreto(): string {
    const propio = this.config.get<string>('VIDEO_TOKEN_SECRET');
    if (propio?.trim()) return propio.trim();

    // Sin secreto propio se deriva uno del de sesiones, para no quedar sin
    // firma en un despliegue que no lo configuró — pero NO es el mismo valor.
    const base = this.config.get<string>('JWT_SECRET') ?? 'dev-secret';
    return `video:${base}`;
  }
}

const EMISOR = 'falcon.video';
