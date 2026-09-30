import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigSmsEntity, ProveedorSms } from './config-sms.entity';
import { InfobipRemitente } from './infobip.remitente';
import { InalambriaRemitente } from './inalambria.remitente';
import { cifrar, descifrar } from '../common/secretos';

/**
 * La fila que guarda la configuración. Es UNA para toda la plataforma: la
 * cuenta del proveedor la tiene el operador del SaaS, no cada municipio. La
 * columna `tenant` de esta tabla sigue existiendo porque es la llave única de
 * la fila, no porque haya una configuración por instancia.
 */
export const TENANT_CONFIG_SMS = '__global__';

/** Lo que se le puede mostrar al administrador: todo menos la credencial. */
export interface ConfigSmsVisible {
  proveedor: ProveedorSms;
  baseUrl: string | null;
  sender: string | null;
  activo: boolean;
  /** true = hay una credencial guardada. Nunca se devuelve cuál. */
  tieneApiKey: boolean;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

/**
 * Envío de SMS saliente con el proveedor configurado para la plataforma.
 *
 * Es UNA configuración para todas las instancias, no una por municipio: la
 * cuenta del proveedor —y la factura— es del operador del SaaS. Por eso
 * `enviar()` no recibe instancia: no habría nada que hacer con ella.
 *
 * Cambiar de proveedor es editar esa fila desde Plataforma, sin redespliegue:
 * por eso el proveedor se resuelve en cada envío y no al arrancar.
 *
 * Si no hay credencial configurada, o el proveedor falla, devuelve false SIN
 * lanzar. Quien lo llama —la videollamada— tiene que poder seguir: el enlace
 * sigue siendo válido y el despachador puede dictarlo o copiarlo. Un SMS que no
 * sale no puede tumbar la atención de una emergencia.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @InjectRepository(ConfigSmsEntity) private readonly configs: Repository<ConfigSmsEntity>,
    private readonly infobip: InfobipRemitente,
    private readonly inalambria: InalambriaRemitente,
    private readonly config: ConfigService,
  ) {}

  async enviar(numero: string, mensaje: string): Promise<boolean> {
    const cfg = await this.configs.findOne({ where: { tenant: TENANT_CONFIG_SMS } });

    if (!cfg || !cfg.activo || !cfg.apiKey) {
      this.logger.warn(
        `La plataforma no tiene SMS configurado (o está desactivado) — no se envió a ${numero}. ` +
        'Se configura en Plataforma → Mensajería SMS.',
      );
      return false;
    }

    let apiKey: string;
    try {
      apiKey = descifrar(cfg.apiKey, this.secreto());
    } catch {
      // La llave de cifrado cambió: la credencial guardada ya no se puede leer.
      // Hay que volver a guardarla desde Administración.
      this.logger.error(
        'No se pudo descifrar la credencial de SMS: la llave de cifrado cambió. ' +
        'Vuelva a guardarla en Plataforma → Mensajería SMS.',
      );
      return false;
    }

    const datos = { baseUrl: cfg.baseUrl, apiKey, sender: cfg.sender };

    switch (cfg.proveedor) {
      case 'INFOBIP':            return this.infobip.enviar(datos, numero, mensaje);
      case 'INALAMBRIA_EXPRESS': return this.inalambria.enviar(datos, numero, mensaje);
      default:
        this.logger.warn(`Proveedor de SMS desconocido: ${cfg.proveedor}`);
        return false;
    }
  }

  /** Lo que ve el administrador. Sin la credencial, solo si la hay. */
  async ver(tenant: string): Promise<ConfigSmsVisible> {
    const cfg = await this.configs.findOne({ where: { tenant } });
    return {
      proveedor: cfg?.proveedor ?? 'INFOBIP',
      baseUrl: cfg?.baseUrl ?? null,
      sender: cfg?.sender ?? null,
      activo: cfg?.activo ?? false,
      tieneApiKey: !!cfg?.apiKey,
      actualizadoPor: cfg?.actualizadoPor ?? null,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  /**
   * Guarda la configuración. Una `apiKey` vacía CONSERVA la que había: el
   * formulario no puede mostrar la credencial, así que si exigiera reescribirla
   * en cada cambio, editar el remitente borraría la clave.
   */
  async guardar(
    tenant: string,
    datos: {
      proveedor?: ProveedorSms;
      apiKey?: string;
      baseUrl?: string | null;
      sender?: string | null;
      activo?: boolean;
    },
    actor: string,
  ): Promise<ConfigSmsVisible> {
    const cfg = (await this.configs.findOne({ where: { tenant } }))
      ?? this.configs.create({ tenant, proveedor: 'INFOBIP', activo: true });

    if (datos.proveedor) cfg.proveedor = datos.proveedor;
    if (datos.baseUrl !== undefined) cfg.baseUrl = datos.baseUrl?.trim() || null;
    if (datos.sender !== undefined) cfg.sender = datos.sender?.trim() || null;
    if (datos.activo !== undefined) cfg.activo = datos.activo;
    if (datos.apiKey?.trim()) cfg.apiKey = cifrar(datos.apiKey.trim(), this.secreto());

    cfg.actualizadoPor = actor;
    await this.configs.save(cfg);
    return this.ver(tenant);
  }

  private secreto(): string {
    return this.config.get<string>('JWT_SECRET') ?? 'dev-secret';
  }
}
