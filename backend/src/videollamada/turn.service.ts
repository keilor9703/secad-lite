import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firmarCredencial } from './credenciales-turn';

/** Lo que el navegador le pasa tal cual a `new RTCPeerConnection({ iceServers })`. */
export interface ServidorIce {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface ConfiguracionIce {
  iceServers: ServidorIce[];
  /** Marca unix en que vence la credencial, para que el cliente la renueve. */
  venceEn?: number;
}

/** `a, b ,, c` → `['a','b','c']`. Tolera espacios y entradas vacías. */
export function separarUrls(valor: string | undefined | null): string[] {
  return (valor ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

const STUN_POR_DEFECTO = 'stun:stun.l.google.com:19302';

/**
 * Entrega los servidores ICE de la videollamada, con la credencial del TURN
 * firmada en el momento.
 *
 * Si el despliegue todavía no configuró `TURN_SECRET` y `TURN_URLS`, devuelve
 * solo el STUN y NO falla: el frontend conserva su respaldo —la credencial
 * estática de `/config/runtime.json`— y la videollamada sigue funcionando
 * igual que antes. Eso es lo que permite desplegar este cambio sin coordinar
 * el reinicio de coturn con el del backend.
 */
@Injectable()
export class TurnService {
  private readonly log = new Logger(TurnService.name);
  private avisoDado = false;

  constructor(private readonly config: ConfigService) {}

  /** ¿Está el backend en condiciones de firmar credenciales? */
  get habilitado(): boolean {
    return Boolean(this.secreto && this.urls.length);
  }

  private get secreto(): string {
    return (this.config.get<string>('TURN_SECRET') ?? '').trim();
  }

  private get urls(): string[] {
    return separarUrls(this.config.get<string>('TURN_URLS'));
  }

  private get stun(): string[] {
    const propio = separarUrls(this.config.get<string>('STUN_URLS'));
    return propio.length ? propio : [STUN_POR_DEFECTO];
  }

  /**
   * @param etiqueta quién pide la credencial; queda en los logs de coturn y
   *   sirve para rastrear un abuso hasta la sesión que lo originó.
   */
  obtener(etiqueta?: string): ConfiguracionIce {
    const iceServers: ServidorIce[] = [{ urls: this.stun }];

    if (!this.habilitado) {
      if (!this.avisoDado) {
        this.avisoDado = true;
        this.log.warn(
          'Sin TURN_SECRET o TURN_URLS: no se firman credenciales. El frontend ' +
          'seguirá usando la credencial estática de /config/runtime.json.',
        );
      }
      return { iceServers };
    }

    const segundos = Number(this.config.get<string>('TURN_TTL_SEGUNDOS'));
    const c = firmarCredencial(this.secreto, etiqueta, segundos);

    iceServers.push({
      urls: this.urls,
      username: c.username,
      credential: c.credential,
    });

    return { iceServers, venceEn: c.venceEn };
  }
}
