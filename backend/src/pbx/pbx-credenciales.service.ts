import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigPbxEntity } from './config-pbx.entity';
import { cifrar, descifrar } from '../common/secretos';
import { CredencialesPbx, DescriptorProveedor } from './proveedores/proveedor';
import { descriptor as descriptorDe, PROVEEDOR_POR_DEFECTO } from './proveedores/registro';

/**
 * Las credenciales de la planta de cada instancia: leerlas, descifrarlas y
 * guardarlas, sin saber de qué proveedor se trata.
 *
 * Quién decide qué se cifra es el **descriptor** del proveedor, no una lista
 * escrita aquí. Esa es toda la idea: un proveedor nuevo declara sus campos y
 * cuáles son secretos, y el cifrado, el «solo de escritura» y el «nunca vuelve
 * al navegador» salen de ahí solos. Mientras fueron dos columnas con nombre de
 * Zadarma, esas tres reglas estaban escritas a mano, y a mano se olvidan.
 */
@Injectable()
export class PbxCredencialesService {
  private readonly log = new Logger(PbxCredencialesService.name);

  constructor(
    @InjectRepository(ConfigPbxEntity) private readonly repo: Repository<ConfigPbxEntity>,
  ) {}

  /** La fila de la instancia, o null si nunca se configuró. */
  configDe(tenant: string): Promise<ConfigPbxEntity | null> {
    return this.repo.findOne({ where: { tenant } });
  }

  /** La clave del proveedor de esa fila; sin fila, el de por defecto. */
  claveProveedor(fila: ConfigPbxEntity | null): string {
    return fila?.proveedor || PROVEEDOR_POR_DEFECTO;
  }

  /**
   * Las credenciales en claro, para verificar firmas y firmar peticiones.
   *
   * Un campo que no se puede descifrar —la llave de cifrado del servidor
   * cambió— sale VACÍO y queda registrado, en vez de reventar: vacío hace que
   * la verificación falle y el aviso se rechace con su motivo, que es lo
   * correcto. Reventar dejaría la central reintentando contra un 500.
   */
  enClaro(fila: ConfigPbxEntity | null): CredencialesPbx {
    const guardadas = leerJson(fila?.credenciales);
    const d = descriptorDe(this.claveProveedor(fila));
    if (!d) return {};
    const claro: CredencialesPbx = {};
    for (const campo of d.credenciales) {
      const valor = guardadas[campo.clave];
      if (!valor) continue;
      if (!campo.secreto) { claro[campo.clave] = valor; continue; }
      try {
        claro[campo.clave] = descifrar(valor, this.llave());
      } catch {
        this.log.error(
          `No se pudo descifrar «${campo.clave}» de la planta de «${fila?.tenant}»: la llave de cifrado cambió. `
          + 'Vuelva a guardarlo en Plataforma.',
        );
      }
    }
    return claro;
  }

  /** Lo guardado tal cual (cifrado incluido), para poder mezclar al escribir. */
  comoEstanGuardadas(fila: ConfigPbxEntity | null): CredencialesPbx {
    return leerJson(fila?.credenciales);
  }

  /**
   * Mezcla lo que llega del formulario con lo que ya había.
   *
   * Dos reglas, y las dos importan:
   *
   * 1. **Lo que no viene, no se toca.** Un formulario que nunca recibió el
   *    secreto no puede reenviarlo; sin esta regla, apagar la integración lo
   *    borraría sin querer.
   * 2. **Lo que es secreto se cifra**, según el descriptor.
   *
   * Las credenciales de OTRO proveedor se conservan: quien pasa de Zadarma a
   * YACO y vuelve no tiene que volver a teclear sus llaves. Son inertes
   * mientras ese proveedor no esté seleccionado, porque nadie las lee.
   */
  mezclar(
    d: DescriptorProveedor, guardadas: CredencialesPbx, entrantes: CredencialesPbx | undefined,
  ): CredencialesPbx {
    const salida: CredencialesPbx = { ...guardadas };
    for (const campo of d.credenciales) {
      const valor = entrantes?.[campo.clave]?.trim();
      if (valor === undefined) continue;
      if (valor === '') { delete salida[campo.clave]; continue; }
      salida[campo.clave] = campo.secreto ? cifrar(valor, this.llave()) : valor;
    }
    return salida;
  }

  /** Qué campos requeridos del proveedor están puestos, mirando lo guardado. */
  puestas(d: DescriptorProveedor, guardadas: CredencialesPbx): CredencialesPbx {
    const r: CredencialesPbx = {};
    for (const campo of d.credenciales) if (guardadas[campo.clave]) r[campo.clave] = 'puesto';
    return r;
  }

  private llave(): string {
    return process.env.JWT_SECRET ?? '';
  }
}

/** El JSON de la columna, tolerante: una fila corrupta no tumba la telefonía. */
function leerJson(texto: string | null | undefined): CredencialesPbx {
  if (!texto?.trim()) return {};
  try {
    const v = JSON.parse(texto) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const r: CredencialesPbx = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') r[k] = val;
    }
    return r;
  } catch {
    return {};
  }
}
