import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigElsEntity } from './config-els.entity';
import { cifrar, descifrar } from '../common/secretos';

/** Fila única de configuración, igual que en SMS. */
export const TENANT_CONFIG_ELS = '__global__';

/** Lo que se le puede mostrar al superadmin: todo menos el secreto. */
export interface ConfigElsVisible {
  baseUrl: string | null;
  agencia: string | null;
  clienteId: string | null;
  casoPorDefecto: string | null;
  activo: boolean;
  /** true = hay un secreto guardado. Nunca se devuelve cuál. */
  tieneSecreto: boolean;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

/** Lo que la recepción necesita saber de una consulta. */
export interface UbicacionEls {
  lat: number;
  lng: number;
  /** De dónde la sacó el proveedor (p. ej. "CALL"). */
  origen: string | null;
  /** Cuándo se tomó la posición, no cuándo se consultó. */
  momento: Date | null;
}

/** Cuánto se espera al proveedor antes de rendirse. */
const ESPERA_MS = 6_000;

/**
 * Geolocalización automática del llamante (Android ELS) a través del
 * proveedor configurado para la plataforma.
 *
 * El operador está con una emergencia al teléfono: esto es una ayuda, nunca un
 * requisito. Por eso NADA de aquí lanza — ni la falta de configuración, ni un
 * 404 (el caso normal: el teléfono no reportó ubicación o no es compatible),
 * ni una caída del proveedor, ni que se agote la espera. Todo eso devuelve
 * `null` y la recepción sigue como siempre, con el operador preguntando la
 * dirección.
 */
@Injectable()
export class ElsService {
  private readonly logger = new Logger(ElsService.name);

  constructor(
    @InjectRepository(ConfigElsEntity) private readonly configs: Repository<ConfigElsEntity>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Pregunta al proveedor dónde estaba el teléfono al llamar.
   *
   * @param telefono Número del llamante, con indicativo o sin él.
   * @param caso Identificador del caso, si ya existe.
   */
  async ubicar(telefono: string, caso?: string): Promise<UbicacionEls | null> {
    const numero = this.soloDigitos(telefono);
    if (!numero) return null;

    const cfg = await this.configs.findOne({ where: { tenant: TENANT_CONFIG_ELS } });
    if (!cfg?.activo || !cfg.baseUrl || !cfg.agencia || !cfg.clienteId || !cfg.clienteSecreto) {
      this.logger.warn(
        'La plataforma no tiene la geolocalización ELS configurada (o está desactivada). ' +
        'Se configura en Plataforma → Geolocalización ELS.',
      );
      return null;
    }

    let secreto: string;
    try {
      secreto = descifrar(cfg.clienteSecreto, this.secreto());
    } catch {
      this.logger.error(
        'No se pudo descifrar el secreto de ELS: la llave de cifrado cambió. ' +
        'Vuelva a guardarlo en Plataforma → Geolocalización ELS.',
      );
      return null;
    }

    const url = new URL(
      `/v1/rem/trigger/hook/${encodeURIComponent(cfg.agencia)}/trigger`,
      cfg.baseUrl.replace(/\/+$/, '') + '/',
    );
    url.searchParams.set('caller_id', numero);
    url.searchParams.set('case_id', caso?.trim() || cfg.casoPorDefecto?.trim() || 'abc123');

    const credencial = Buffer.from(`${cfg.clienteId}:${secreto}`).toString('base64');

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${credencial}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_MS),
      });

      // 404 es la respuesta NORMAL cuando el teléfono no reportó ubicación o no
      // es compatible. No es un fallo y no se registra como tal: pasaría en la
      // mayoría de las llamadas y llenaría el registro de ruido.
      if (r.status === 404) return null;

      if (!r.ok) {
        this.logger.warn(`El proveedor de ELS respondió ${r.status} para ${numero}.`);
        return null;
      }

      return this.interpretar(await r.json(), numero);
    } catch (e) {
      // Incluye el tiempo agotado: el operador no puede quedarse esperando.
      this.logger.warn(`No se pudo consultar la ubicación ELS de ${numero}: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Saca la posición de la respuesta del proveedor.
   *
   * Viene como una lista y las coordenadas como texto; se valida que sean
   * números dentro de rango en vez de confiar. Una coordenada inventada pondría
   * un punto en el mapa y mandaría una patrulla a otro sitio: es peor que no
   * tener ninguna.
   */
  private interpretar(cuerpo: unknown, numero: string): UbicacionEls | null {
    const lista = (cuerpo as { results?: unknown })?.results;
    if (!Array.isArray(lista) || lista.length === 0) return null;

    const r = lista[0] as Record<string, unknown>;
    const lat = Number(r['latitude']);
    const lng = Number(r['longitude']);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)
        || Math.abs(lat) > 90 || Math.abs(lng) > 180
        || (lat === 0 && lng === 0)) {
      this.logger.warn(`El proveedor de ELS devolvió coordenadas no usables para ${numero}.`);
      return null;
    }

    // El proveedor manda el instante en segundos con decimales.
    const seg = Number(r['location_time']);
    const momento = Number.isFinite(seg) && seg > 0 ? new Date(seg * 1000) : null;

    return {
      lat,
      lng,
      origen: typeof r['source'] === 'string' ? r['source'] : null,
      momento,
    };
  }

  /**
   * El proveedor acepta el número con indicativo o sin él, pero no con los
   * espacios, guiones y paréntesis con que suele llegar de la planta.
   */
  private soloDigitos(telefono: string): string {
    return (telefono ?? '').replace(/\D+/g, '');
  }

  async ver(tenant: string): Promise<ConfigElsVisible> {
    const cfg = await this.configs.findOne({ where: { tenant } });
    return {
      baseUrl: cfg?.baseUrl ?? null,
      agencia: cfg?.agencia ?? null,
      clienteId: cfg?.clienteId ?? null,
      casoPorDefecto: cfg?.casoPorDefecto ?? null,
      activo: cfg?.activo ?? false,
      tieneSecreto: !!cfg?.clienteSecreto,
      actualizadoPor: cfg?.actualizadoPor ?? null,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  /**
   * Guarda la configuración. Un `clienteSecreto` vacío CONSERVA el que había:
   * el formulario no puede mostrarlo, así que si exigiera reescribirlo en cada
   * cambio, corregir la agencia borraría la credencial.
   */
  async guardar(
    tenant: string,
    datos: {
      baseUrl?: string | null;
      agencia?: string | null;
      clienteId?: string | null;
      clienteSecreto?: string;
      casoPorDefecto?: string | null;
      activo?: boolean;
    },
    actor: string,
  ): Promise<ConfigElsVisible> {
    const cfg = (await this.configs.findOne({ where: { tenant } }))
      ?? this.configs.create({ tenant, activo: true });

    if (datos.baseUrl !== undefined) cfg.baseUrl = datos.baseUrl?.trim() || null;
    if (datos.agencia !== undefined) cfg.agencia = datos.agencia?.trim() || null;
    if (datos.clienteId !== undefined) cfg.clienteId = datos.clienteId?.trim() || null;
    if (datos.casoPorDefecto !== undefined) cfg.casoPorDefecto = datos.casoPorDefecto?.trim() || null;
    if (datos.activo !== undefined) cfg.activo = datos.activo;
    if (datos.clienteSecreto?.trim()) {
      cfg.clienteSecreto = cifrar(datos.clienteSecreto.trim(), this.secreto());
    }

    cfg.actualizadoPor = actor;
    await this.configs.save(cfg);
    return this.ver(tenant);
  }

  private secreto(): string {
    return this.config.get<string>('JWT_SECRET') ?? 'dev-secret';
  }
}
